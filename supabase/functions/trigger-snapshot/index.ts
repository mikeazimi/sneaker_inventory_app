// Supabase Edge Function: trigger-snapshot
// Triggers a ShipHero inventory snapshot generation and tracks it in sync_jobs

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";

// =============================================================================
// TYPES
// =============================================================================

interface TriggerSnapshotRequest {
  warehouse_id?: number; // Optional: filter by specific warehouse (if omitted, syncs ALL warehouses individually)
}

interface WarehouseRecord {
  shiphero_id_plain: number;
  name: string;
}

interface SnapshotResult {
  warehouse_id: number;
  warehouse_name: string;
  snapshot_id: string;
  status: string;
  success: boolean;
  error?: string;
}

interface ShipHeroGraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: {
      code?: string;
      status?: number;
    };
  }>;
}

interface InventorySnapshotResponse {
  inventory_generate_snapshot: {
    request_id: string;
    complexity: number;
    snapshot: {
      snapshot_id: string;
      status: string;
      created_at: string;
    };
  };
}

interface ApiCredentials {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

// =============================================================================
// CUSTOM ERROR CLASSES
// =============================================================================

class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenExpiredError";
  }
}

class ShipHeroAPIError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ShipHeroAPIError";
    this.statusCode = statusCode;
  }
}

class NoCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoCredentialsError";
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SHIPHERO_GRAPHQL_URL = "https://public-api.shiphero.com/graphql";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Encode a plain warehouse ID to ShipHero's base64 format
 * ShipHero uses format: "V2FyZWhvdXNlOjEyMzQ1" which decodes to "Warehouse:12345"
 */
function encodeWarehouseId(plainId: number): string {
  const idString = `Warehouse:${plainId}`;
  // Use btoa for base64 encoding (available in Deno)
  return btoa(idString);
}

// =============================================================================
// GRAPHQL MUTATION
// =============================================================================

// The inventory_generate_snapshot mutation triggers ShipHero to create
// a point-in-time snapshot of inventory data
// If warehouse_id is provided, only that warehouse's inventory is included
const createSnapshotMutation = (warehouseId?: string) => `
  mutation GenerateInventorySnapshot {
    inventory_generate_snapshot(data: {${warehouseId ? `warehouse_id: "${warehouseId}"` : ''}}) {
      request_id
      complexity
      snapshot {
        snapshot_id
        status
        created_at
      }
    }
  }
`;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if access token is expired or about to expire (within 5 minutes)
 */
function isTokenExpired(expiresAt: string): boolean {
  const expirationDate = new Date(expiresAt);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minute buffer
  return expirationDate.getTime() - bufferMs <= now.getTime();
}

/**
 * Call ShipHero GraphQL API with authentication
 */
async function callShipHeroAPI<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string
): Promise<T> {
  console.log("Calling ShipHero API...");
  console.log("Variables:", JSON.stringify(variables));

  const response = await fetch(SHIPHERO_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const responseText = await response.text();
  console.log("ShipHero response status:", response.status);
  console.log("ShipHero response:", responseText.substring(0, 1000));

  // Check for HTTP-level auth errors
  if (response.status === 401 || response.status === 403) {
    throw new TokenExpiredError(
      `ShipHero API returned ${response.status}. Access token may be expired. ` +
        `Please refresh the token using the shiphero-auth function.`
    );
  }

  if (!response.ok) {
    throw new ShipHeroAPIError(
      `ShipHero API request failed: ${response.status} ${response.statusText}. Response: ${responseText.substring(0, 300)}`,
      response.status
    );
  }

  let result: ShipHeroGraphQLResponse<T>;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new ShipHeroAPIError(`Failed to parse response: ${responseText.substring(0, 300)}`, 500);
  }

  // Check for GraphQL-level errors
  if (result.errors && result.errors.length > 0) {
    const error = result.errors[0];
    const statusCode = error.extensions?.status || 500;
    const errorCode = error.extensions?.code || "UNKNOWN";

    console.log("GraphQL error:", JSON.stringify(error));

    // Check for authentication errors in GraphQL response
    if (
      statusCode === 401 ||
      statusCode === 403 ||
      errorCode === "UNAUTHENTICATED" ||
      errorCode === "FORBIDDEN" ||
      error.message.toLowerCase().includes("unauthorized") ||
      error.message.toLowerCase().includes("invalid token")
    ) {
      throw new TokenExpiredError(
        `ShipHero authentication failed: ${error.message}. ` +
          `Please refresh the token using the shiphero-auth function.`
      );
    }

    throw new ShipHeroAPIError(`ShipHero GraphQL error: ${error.message}`, statusCode);
  }

  if (!result.data) {
    throw new ShipHeroAPIError("No data returned from ShipHero API", 500);
  }

  return result.data;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    // Parse request body (optional warehouse_id filter)
    let body: TriggerSnapshotRequest = {};
    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty body is OK - will generate snapshot for all warehouses
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

    // ==========================================================================
    // STEP 1: Retrieve valid access_token from api_credentials
    // ==========================================================================
    console.log("Fetching stored credentials...");

    const { data: credentials, error: credentialsError } = await supabase
      .from("api_credentials")
      .select("id, access_token, refresh_token, expires_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (credentialsError || !credentials) {
      console.error("Failed to fetch credentials:", credentialsError);
      throw new NoCredentialsError(
        "No API credentials found. Please authenticate first using the shiphero-auth function."
      );
    }

    const creds = credentials as ApiCredentials;

    // Check if token is expired
    if (isTokenExpired(creds.expires_at)) {
      console.log("Access token is expired or about to expire");
      throw new TokenExpiredError(
        `Access token expired at ${creds.expires_at}. ` +
          `Please refresh the token using the shiphero-auth function with {refresh: true}.`
      );
    }

    console.log("Valid access token retrieved");

    // ==========================================================================
    // STEP 2: Determine which warehouses to sync
    // ==========================================================================

    let warehousesToSync: WarehouseRecord[] = [];

    if (body.warehouse_id) {
      // Single warehouse specified
      warehousesToSync = [{ shiphero_id_plain: body.warehouse_id, name: `Warehouse ${body.warehouse_id}` }];
      console.log(`Syncing single warehouse: ${body.warehouse_id}`);
    } else {
      // Fetch ALL active warehouses from database
      console.log("No warehouse_id specified - fetching all warehouses to sync individually");
      
      const { data: warehouses, error: warehouseError } = await supabase
        .from("warehouse_registry")
        .select("shiphero_id_plain, name")
        .eq("is_active", true);

      if (warehouseError || !warehouses || warehouses.length === 0) {
        console.error("Failed to fetch warehouses:", warehouseError);
        return new Response(
          JSON.stringify({
            error: "no_warehouses",
            message: "No active warehouses found. Please sync warehouses first.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      warehousesToSync = warehouses as WarehouseRecord[];
      console.log(`Found ${warehousesToSync.length} warehouses to sync`);
    }

    // ==========================================================================
    // STEP 3: Trigger a snapshot for EACH warehouse
    // ==========================================================================

    const results: SnapshotResult[] = [];
    const syncJobs: Array<{ id: string; snapshot_id: string; warehouse_id: number; status: string }> = [];

    for (const warehouse of warehousesToSync) {
      try {
        const warehouseIdBase64 = encodeWarehouseId(warehouse.shiphero_id_plain);
        console.log(`\n--- Triggering snapshot for: ${warehouse.name} (${warehouse.shiphero_id_plain} / ${warehouseIdBase64}) ---`);

        // Create the mutation for this warehouse
        const mutation = createSnapshotMutation(warehouseIdBase64);

        // Call ShipHero API
        const snapshotResponse = await callShipHeroAPI<InventorySnapshotResponse>(
          mutation,
          {},
          creds.access_token
        );

        const snapshotData = snapshotResponse.inventory_generate_snapshot;
        const snapshot = snapshotData.snapshot;

        console.log(`Snapshot created for ${warehouse.name}:`, {
          snapshot_id: snapshot.snapshot_id,
          status: snapshot.status,
        });

        // Log to sync_jobs table
        const { data: syncJob, error: insertError } = await supabase
          .from("sync_jobs")
          .insert({
            snapshot_id: snapshot.snapshot_id,
            job_id: snapshotData.request_id,
            warehouse_id: warehouse.shiphero_id_plain,
            status: "pending",
          })
          .select("id, snapshot_id, status")
          .single();

        if (insertError) {
          console.error(`Failed to create sync job for ${warehouse.name}:`, insertError);
        } else {
          syncJobs.push({
            id: syncJob.id,
            snapshot_id: snapshot.snapshot_id,
            warehouse_id: warehouse.shiphero_id_plain,
            status: "pending",
          });
        }

        results.push({
          warehouse_id: warehouse.shiphero_id_plain,
          warehouse_name: warehouse.name,
          snapshot_id: snapshot.snapshot_id,
          status: snapshot.status,
          success: true,
        });

        // Small delay between API calls to avoid rate limiting
        if (warehousesToSync.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to create snapshot for ${warehouse.name}:`, errorMsg);

        results.push({
          warehouse_id: warehouse.shiphero_id_plain,
          warehouse_name: warehouse.name,
          snapshot_id: "",
          status: "failed",
          success: false,
          error: errorMsg,
        });
      }
    }

    // ==========================================================================
    // STEP 4: Return summary response
    // ==========================================================================

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        success: failCount === 0,
        message: `Triggered ${successCount} snapshot(s)${failCount > 0 ? `, ${failCount} failed` : ""}`,
        total_warehouses: warehousesToSync.length,
        successful: successCount,
        failed: failCount,
        sync_jobs: syncJobs,
        results: results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Trigger snapshot error:", error);

    // Handle token expired errors
    if (error instanceof TokenExpiredError) {
      return new Response(
        JSON.stringify({
          error: "token_expired",
          message: error.message,
          action: "Call shiphero-auth with {refresh: true} to refresh the token",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Handle no credentials error
    if (error instanceof NoCredentialsError) {
      return new Response(
        JSON.stringify({
          error: "no_credentials",
          message: error.message,
          action: "Call shiphero-auth with {username, password} to authenticate",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Handle ShipHero API errors
    if (error instanceof ShipHeroAPIError) {
      return new Response(
        JSON.stringify({
          error: "shiphero_api_error",
          message: error.message,
          status_code: error.statusCode,
        }),
        {
          status: error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Handle unexpected errors
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

