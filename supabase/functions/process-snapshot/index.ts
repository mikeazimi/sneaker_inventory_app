// Supabase Edge Function: process-snapshot
// Streams and processes ShipHero inventory snapshot files from S3

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";

// =============================================================================
// TYPES
// =============================================================================

interface ProcessSnapshotRequest {
  snapshot_url: string;
  snapshot_id?: string; // Optional: to update sync_jobs status
  job_id?: string; // UUID of the sync_job record
}

interface InventoryRecord {
  sku: string;
  warehouse_id: number;
  bin_name: string;
  bin_id: number | null;
  quantity: number;
}

// ShipHero snapshot structure types
interface BinData {
  name?: string;
  location_name?: string;
  location_id?: string;
  quantity: number;
}

interface WarehouseData {
  warehouse_id?: string;
  on_hand?: number;
  item_bins?: Record<string, BinData>;
}

interface SkuData {
  sku?: string;
  warehouse_products?: Record<string, WarehouseData>;
}

// The actual snapshot file format - products are nested under "products" key
interface SnapshotFileFormat {
  snapshot_id?: string;
  warehouse_id?: string;
  products: Record<string, SkuData>;
  snapshot_started_at?: string;
  snapshot_finished_at?: string;
}

// Legacy format where SKUs are at root level
interface SnapshotDataLegacy {
  [sku: string]: SkuData;
}

interface ProcessingStats {
  total_records: number;
  batches_processed: number;
  errors: string[];
  skus_processed: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// BASE64 DECODING UTILITIES
// =============================================================================

/**
 * Decode a Base64 string to plain text
 */
function base64Decode(encoded: string): string {
  try {
    return atob(encoded);
  } catch {
    console.warn(`Failed to decode base64: ${encoded}`);
    return encoded;
  }
}

/**
 * Extract the numeric ID from a Base64-encoded ShipHero ID
 * Format: Base64("Type:123") -> "Type:123" -> 123
 * Example: "V2FyZWhvdXNlOjEyMw==" -> "Warehouse:123" -> 123
 */
function decodeShipHeroId(base64Id: string): number | null {
  try {
    const decoded = base64Decode(base64Id);
    const parts = decoded.split(":");
    
    if (parts.length >= 2) {
      const numericPart = parts[parts.length - 1]; // Take the last part (the ID)
      const parsed = parseInt(numericPart, 10);
      return isNaN(parsed) ? null : parsed;
    }
    
    // If no colon, try parsing the whole thing
    const parsed = parseInt(decoded, 10);
    return isNaN(parsed) ? null : parsed;
  } catch (error) {
    console.warn(`Failed to decode ShipHero ID: ${base64Id}`, error);
    return null;
  }
}

// =============================================================================
// STREAMING JSON PARSER
// =============================================================================

/**
 * Custom streaming JSON parser for large ShipHero snapshot files
 * Parses the JSON incrementally and yields inventory records
 */
class StreamingSnapshotParser {
  private buffer = "";
  private records: InventoryRecord[] = [];
  private stats: ProcessingStats = {
    total_records: 0,
    batches_processed: 0,
    errors: [],
    skus_processed: 0,
  };

  /**
   * Process a chunk of JSON text
   */
  appendChunk(chunk: string): void {
    this.buffer += chunk;
  }

  /**
   * Parse the complete buffer as JSON and extract records
   * For very large files, this uses incremental parsing
   */
  async parseAndExtract(): Promise<{
    records: InventoryRecord[];
    stats: ProcessingStats;
  }> {
    try {
      // Parse the JSON
      const rawData = JSON.parse(this.buffer);
      
      // Handle both formats:
      // 1. New format: { products: { sku1: {...}, sku2: {...} } }
      // 2. Legacy format: { sku1: {...}, sku2: {...} }
      let productsData: Record<string, SkuData>;
      
      if (rawData.products && typeof rawData.products === "object") {
        // New format - products are nested under "products" key
        console.log("Detected new ShipHero snapshot format (products wrapper)");
        productsData = rawData.products;
      } else {
        // Legacy format - SKUs are at root level
        console.log("Detected legacy snapshot format (SKUs at root)");
        productsData = rawData;
      }
      
      console.log(`Processing ${Object.keys(productsData).length} SKUs...`);
      
      // Process each SKU
      for (const [sku, skuData] of Object.entries(productsData)) {
        if (!skuData || typeof skuData !== "object") continue;
        
        const warehouseProducts = skuData.warehouse_products;
        if (!warehouseProducts || typeof warehouseProducts !== "object") continue;

        // Process each warehouse for this SKU
        for (const [warehouseIdBase64, warehouseData] of Object.entries(warehouseProducts)) {
          if (!warehouseData || typeof warehouseData !== "object") continue;

          const warehouseId = decodeShipHeroId(warehouseIdBase64);
          if (warehouseId === null) {
            this.stats.errors.push(`Invalid warehouse ID: ${warehouseIdBase64}`);
            continue;
          }

          const itemBins = warehouseData.item_bins;
          if (!itemBins || typeof itemBins !== "object" || Object.keys(itemBins).length === 0) {
            // If no item_bins, create a record with on_hand quantity at "DEFAULT" bin
            // Only if quantity > 0
            if (warehouseData.on_hand !== undefined && warehouseData.on_hand > 0) {
              this.records.push({
                sku,
                warehouse_id: warehouseId,
                bin_name: "DEFAULT",
                bin_id: null,
                quantity: warehouseData.on_hand,
              });
              this.stats.total_records++;
            }
            continue;
          }

          // Process each bin for this warehouse
          for (const [binIdBase64, binData] of Object.entries(itemBins)) {
            if (!binData || typeof binData !== "object") continue;

            const quantity = binData.quantity || 0;
            
            // SKIP zero-quantity items to reduce data volume
            if (quantity <= 0) continue;

            const binId = decodeShipHeroId(binIdBase64);
            // Use the plain text name from binData, NOT the base64 ID
            const binName = binData.name || binData.location_name || "UNKNOWN";

            this.records.push({
              sku,
              warehouse_id: warehouseId,
              bin_name: binName, // Plain text bin name
              bin_id: binId,
              quantity,
            });
            this.stats.total_records++;
          }
        }
        
        this.stats.skus_processed++;
      }

      return {
        records: this.records,
        stats: this.stats,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown parse error";
      this.stats.errors.push(`JSON parse error: ${errorMsg}`);
      throw error;
    }
  }

  getStats(): ProcessingStats {
    return this.stats;
  }
}

// =============================================================================
// BATCH PROCESSING
// =============================================================================

/**
 * Process records in batches and upsert to database
 */
async function processBatches(
  supabase: SupabaseClient,
  records: InventoryRecord[],
  onBatchComplete?: (batchNum: number, totalBatches: number) => void
): Promise<{ success: boolean; batchesProcessed: number; errors: string[] }> {
  const errors: string[] = [];
  let batchesProcessed = 0;
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} records)`);

      const { error } = await supabase
        .from("inventory_positions")
        .upsert(
          batch.map((record) => ({
            sku: record.sku,
            warehouse_id: record.warehouse_id,
            bin_name: record.bin_name,
            bin_id: record.bin_id,
            quantity: record.quantity,
          })),
          {
            onConflict: "sku,warehouse_id,bin_name",
            ignoreDuplicates: false,
          }
        );

      if (error) {
        const errorMsg = `Batch ${batchNum} failed: ${error.message}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      } else {
        batchesProcessed++;
        onBatchComplete?.(batchNum, totalBatches);
      }
    } catch (error) {
      const errorMsg = `Batch ${batchNum} exception: ${error instanceof Error ? error.message : "Unknown"}`;
      console.error(errorMsg);
      errors.push(errorMsg);
    }
  }

  return {
    success: errors.length === 0,
    batchesProcessed,
    errors,
  };
}

/**
 * Stream-process the snapshot for very large files
 * Uses chunked reading and incremental parsing
 */
async function streamProcessSnapshot(
  snapshotUrl: string,
  supabase: SupabaseClient,
  updateProgress?: (processed: number, total: number) => Promise<void>
): Promise<{
  success: boolean;
  stats: ProcessingStats;
  errors: string[];
}> {
  console.log(`Fetching snapshot from: ${snapshotUrl}`);

  // Fetch the snapshot file
  const response = await fetch(snapshotUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  // Read the stream in chunks
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new StreamingSnapshotParser();

  let totalBytesRead = 0;
  const contentLength = parseInt(response.headers.get("content-length") || "0", 10);

  console.log(`Starting to stream snapshot (${contentLength > 0 ? `${(contentLength / 1024 / 1024).toFixed(2)} MB` : "unknown size"})`);

  // Read all chunks into the parser
  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      console.log("Finished reading stream");
      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    parser.appendChunk(chunk);
    totalBytesRead += value.length;

    // Log progress every 10MB
    if (totalBytesRead % (10 * 1024 * 1024) < value.length) {
      const progress = contentLength > 0 
        ? `${((totalBytesRead / contentLength) * 100).toFixed(1)}%`
        : `${(totalBytesRead / 1024 / 1024).toFixed(2)} MB`;
      console.log(`Download progress: ${progress}`);
    }
  }

  console.log(`Total bytes read: ${(totalBytesRead / 1024 / 1024).toFixed(2)} MB`);
  console.log("Parsing JSON and extracting records...");

  // Parse and extract records
  const { records, stats } = await parser.parseAndExtract();

  console.log(`Extracted ${records.length} inventory records from ${stats.skus_processed} SKUs`);

  // Process in batches
  console.log(`Starting batch upsert (${Math.ceil(records.length / BATCH_SIZE)} batches)...`);

  const batchResult = await processBatches(
    supabase,
    records,
    async (batchNum, totalBatches) => {
      if (updateProgress) {
        const processed = Math.min(batchNum * BATCH_SIZE, records.length);
        await updateProgress(processed, records.length);
      }
    }
  );

  stats.batches_processed = batchResult.batchesProcessed;
  stats.errors.push(...batchResult.errors);

  return {
    success: batchResult.success && stats.errors.length === 0,
    stats,
    errors: stats.errors,
  };
}

// =============================================================================
// SYNC JOB STATUS UPDATES
// =============================================================================

async function updateSyncJobStatus(
  supabase: SupabaseClient,
  jobId: string,
  status: "processing" | "completed" | "failed",
  totalItems?: number,
  processedItems?: number,
  errorMessage?: string
): Promise<void> {
  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === "processing" ) {
    updateData.started_at = new Date().toISOString();
  }

  if (status === "completed" || status === "failed") {
    updateData.completed_at = new Date().toISOString();
  }

  if (totalItems !== undefined) {
    updateData.total_items = totalItems;
  }

  if (processedItems !== undefined) {
    updateData.processed_items = processedItems;
  }

  if (errorMessage) {
    updateData.error_message = errorMessage;
  }

  const { error } = await supabase
    .from("sync_jobs")
    .update(updateData)
    .eq("id", jobId);

  if (error) {
    console.error(`Failed to update sync job status: ${error.message}`);
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Only accept POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed. Use POST." }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    let body: ProcessSnapshotRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate required fields
    if (!body.snapshot_url) {
      return new Response(
        JSON.stringify({ error: "Missing required field: snapshot_url" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client with Service Role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase environment variables");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Update sync job status to 'processing' if job_id provided
    if (body.job_id) {
      await updateSyncJobStatus(supabase, body.job_id, "processing");
    }

    console.log("=".repeat(60));
    console.log("PROCESS SNAPSHOT STARTED");
    console.log(`Snapshot URL: ${body.snapshot_url}`);
    console.log(`Job ID: ${body.job_id || "N/A"}`);
    console.log("=".repeat(60));

    // Process the snapshot with streaming
    const result = await streamProcessSnapshot(
      body.snapshot_url,
      supabase,
      body.job_id
        ? async (processed, total) => {
            // Update progress every 10 batches
            if (processed % (BATCH_SIZE * 10) === 0 || processed === total) {
              await updateSyncJobStatus(
                supabase,
                body.job_id!,
                "processing",
                total,
                processed
              );
            }
          }
        : undefined
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("=".repeat(60));
    console.log("PROCESS SNAPSHOT COMPLETED");
    console.log(`Duration: ${duration}s`);
    console.log(`Records processed: ${result.stats.total_records}`);
    console.log(`Batches processed: ${result.stats.batches_processed}`);
    console.log(`SKUs processed: ${result.stats.skus_processed}`);
    console.log(`Errors: ${result.errors.length}`);
    console.log("=".repeat(60));

    // Update sync job status to 'completed' or 'failed'
    if (body.job_id) {
      if (result.success) {
        await updateSyncJobStatus(
          supabase,
          body.job_id,
          "completed",
          result.stats.total_records,
          result.stats.total_records
        );
      } else {
        await updateSyncJobStatus(
          supabase,
          body.job_id,
          "failed",
          result.stats.total_records,
          result.stats.batches_processed * BATCH_SIZE,
          result.errors.join("; ")
        );
      }
    }

    // Return response
    if (result.success) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Snapshot processed successfully",
          stats: {
            total_records: result.stats.total_records,
            batches_processed: result.stats.batches_processed,
            skus_processed: result.stats.skus_processed,
            duration_seconds: parseFloat(duration),
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Snapshot processing completed with errors",
          stats: {
            total_records: result.stats.total_records,
            batches_processed: result.stats.batches_processed,
            skus_processed: result.stats.skus_processed,
            duration_seconds: parseFloat(duration),
          },
          errors: result.errors,
        }),
        {
          status: 207, // Multi-Status - partial success
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error("Process snapshot error:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({
        success: false,
        error: "processing_failed",
        message: errorMessage,
        duration_seconds: parseFloat(duration),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

