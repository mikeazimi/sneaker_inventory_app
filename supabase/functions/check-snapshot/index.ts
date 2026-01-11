// =============================================================================
// CHECK SNAPSHOT - Supabase Edge Function
// Checks the status of ALL pending/processing ShipHero inventory snapshots
// Automatically triggers process-snapshot when ready
// Marks stale jobs (>2 hours) as failed
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SHIPHERO_GRAPHQL_URL = "https://public-api.shiphero.com/graphql";

// Jobs older than this are considered stale and will be marked as failed
const STALE_JOB_HOURS = 2;

// Query to check snapshot status
const CHECK_SNAPSHOT_QUERY = `
  query GetSnapshot($snapshot_id: String!) {
    inventory_snapshot(snapshot_id: $snapshot_id) {
      request_id
      complexity
      snapshot {
        snapshot_id
        status
        snapshot_url
        snapshot_expiration
        created_at
        updated_at
        error
      }
    }
  }
`;

interface SnapshotQueryResponse {
  inventory_snapshot: {
    request_id: string;
    complexity: number;
    snapshot: {
      snapshot_id: string;
      status: string;
      snapshot_url: string | null;
      snapshot_expiration: string | null;
      created_at: string;
      updated_at: string;
      error: string | null;
    };
  };
}

interface PendingJob {
  id: string;
  snapshot_id: string;
  warehouse_id: number | null;
  created_at: string;
  status: string;
}

interface JobResult {
  snapshot_id: string;
  warehouse_id: number | null;
  status: string;
  snapshot_url: string | null;
  processing_triggered: boolean;
  marked_stale: boolean;
  error?: string;
}

// Check if a job is stale (older than threshold)
function isJobStale(createdAt: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
  return diffHours > STALE_JOB_HOURS;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get ALL pending AND processing sync jobs (not just pending)
    const { data: activeJobs, error: jobsError } = await supabase
      .from("sync_jobs")
      .select("id, snapshot_id, warehouse_id, created_at, status")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: true }); // Process oldest first

    if (jobsError) {
      console.error("Error fetching active jobs:", jobsError);
      return new Response(
        JSON.stringify({ success: false, message: "Failed to fetch active jobs" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!activeJobs || activeJobs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No active snapshots found", jobs: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${activeJobs.length} active job(s) to check`);

    // Get access token
    const { data: credentials } = await supabase
      .from("api_credentials")
      .select("access_token")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (!credentials?.access_token) {
      return new Response(
        JSON.stringify({ success: false, message: "No credentials found" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check each active job
    const results: JobResult[] = [];
    let completedCount = 0;
    let processingCount = 0;
    let failedCount = 0;
    let staleCount = 0;

    for (const job of activeJobs as PendingJob[]) {
      try {
        console.log(`\n--- Checking snapshot: ${job.snapshot_id} (warehouse: ${job.warehouse_id || "all"}, status: ${job.status}) ---`);

        // First check if job is stale
        if (isJobStale(job.created_at)) {
          console.log(`Job ${job.snapshot_id} is STALE (created: ${job.created_at})`);
          staleCount++;
          
          // Mark as failed due to timeout
          await supabase
            .from("sync_jobs")
            .update({ 
              status: "failed",
              error_message: `Job timed out after ${STALE_JOB_HOURS} hours. Please trigger a new sync.`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          results.push({
            snapshot_id: job.snapshot_id,
            warehouse_id: job.warehouse_id,
            status: "failed",
            snapshot_url: null,
            processing_triggered: false,
            marked_stale: true,
            error: `Timed out after ${STALE_JOB_HOURS} hours`,
          });
          continue;
        }

        // Query ShipHero for snapshot status
        const response = await fetch(SHIPHERO_GRAPHQL_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${credentials.access_token}`,
          },
          body: JSON.stringify({
            query: CHECK_SNAPSHOT_QUERY,
            variables: { snapshot_id: job.snapshot_id },
          }),
        });

        const responseText = await response.text();
        
        if (!response.ok) {
          console.error(`ShipHero API error for ${job.snapshot_id}:`, responseText);
          failedCount++;
          
          // Mark as failed if API error persists
          await supabase
            .from("sync_jobs")
            .update({ 
              status: "failed",
              error_message: `ShipHero API error: ${response.status}`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id);
            
          results.push({
            snapshot_id: job.snapshot_id,
            warehouse_id: job.warehouse_id,
            status: "error",
            snapshot_url: null,
            processing_triggered: false,
            marked_stale: false,
            error: `API error: ${response.status}`,
          });
          continue;
        }

        const result = JSON.parse(responseText);

        if (result.errors) {
          console.error(`GraphQL errors for ${job.snapshot_id}:`, result.errors);
          
          // Check if snapshot not found - mark as failed
          const notFound = result.errors.some((e: any) => 
            e.message?.toLowerCase().includes("not found") || 
            e.message?.toLowerCase().includes("does not exist")
          );
          
          if (notFound) {
            await supabase
              .from("sync_jobs")
              .update({ 
                status: "failed",
                error_message: "Snapshot not found in ShipHero",
                completed_at: new Date().toISOString(),
              })
              .eq("id", job.id);
          }
          
          failedCount++;
          results.push({
            snapshot_id: job.snapshot_id,
            warehouse_id: job.warehouse_id,
            status: "error",
            snapshot_url: null,
            processing_triggered: false,
            marked_stale: false,
            error: result.errors[0]?.message || "GraphQL error",
          });
          continue;
        }

        const snapshotData: SnapshotQueryResponse = result.data;
        const snapshot = snapshotData.inventory_snapshot.snapshot;
        const statusLower = snapshot.status.toLowerCase();

        console.log(`Snapshot ${job.snapshot_id} status: ${snapshot.status}, URL: ${snapshot.snapshot_url || "none"}`);

        // Determine action based on ShipHero status
        // ShipHero returns status like "InventorySnapshotStatus.success" or "InventorySnapshotStatus.complete"
        let processingTriggered = false;
        
        // Check for completion - ShipHero uses "success" or "complete" in the status
        const isComplete = statusLower.includes("complete") || statusLower.includes("success");

        if (isComplete && snapshot.snapshot_url) {
          // Snapshot is ready!
          completedCount++;

          console.log(`Snapshot ${job.snapshot_id} is READY! Triggering data import...`);

          // Only trigger processing if job was pending (not already processing)
          if (job.status === "pending") {
            // Update job status to processing
            await supabase
              .from("sync_jobs")
              .update({ status: "processing", started_at: new Date().toISOString() })
              .eq("id", job.id);

            // Trigger process-snapshot function
            const processUrl = `${supabaseUrl}/functions/v1/process-snapshot`;
            console.log(`Calling process-snapshot at: ${processUrl}`);
            
            try {
              const processResponse = await fetch(processUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${supabaseServiceKey}`,
                  "apikey": supabaseServiceKey,
                },
                body: JSON.stringify({
                  snapshot_id: job.snapshot_id,
                  snapshot_url: snapshot.snapshot_url,
                  job_id: job.id,
                }),
              });
              
              const processResponseText = await processResponse.text();
              console.log(`process-snapshot response (${processResponse.status}): ${processResponseText.substring(0, 500)}`);
              
              if (processResponse.ok) {
                processingTriggered = true;
              } else {
                console.error(`process-snapshot failed: ${processResponse.status} - ${processResponseText}`);
                // Mark job as failed if processing couldn't be triggered
                await supabase
                  .from("sync_jobs")
                  .update({ 
                    status: "failed",
                    error_message: `Failed to trigger processing: ${processResponse.status}`,
                    completed_at: new Date().toISOString(),
                  })
                  .eq("id", job.id);
                failedCount++;
              }
            } catch (err) {
              console.error(`Failed to call process-snapshot for ${job.snapshot_id}:`, err);
              await supabase
                .from("sync_jobs")
                .update({ 
                  status: "failed",
                  error_message: `Processing error: ${err instanceof Error ? err.message : "Unknown"}`,
                  completed_at: new Date().toISOString(),
                })
                .eq("id", job.id);
              failedCount++;
            }
          } else {
            // Job was already processing - check how long it's been processing
            // If it's been too long, try triggering process-snapshot again
            console.log(`Job ${job.snapshot_id} already in processing state`);
            
            // Re-trigger processing if job has been stuck in processing for > 5 minutes
            const jobData = await supabase
              .from("sync_jobs")
              .select("started_at")
              .eq("id", job.id)
              .single();
            
            if (jobData.data?.started_at) {
              const startedAt = new Date(jobData.data.started_at);
              const minutesInProcessing = (Date.now() - startedAt.getTime()) / (1000 * 60);
              
              if (minutesInProcessing > 5) {
                console.log(`Job ${job.snapshot_id} has been processing for ${minutesInProcessing.toFixed(1)} minutes - retrying...`);
                
                // Re-trigger process-snapshot
                const processUrl = `${supabaseUrl}/functions/v1/process-snapshot`;
                try {
                  const processResponse = await fetch(processUrl, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${supabaseServiceKey}`,
                      "apikey": supabaseServiceKey,
                    },
                    body: JSON.stringify({
                      snapshot_id: job.snapshot_id,
                      snapshot_url: snapshot.snapshot_url,
                      job_id: job.id,
                    }),
                  });
                  
                  const processResponseText = await processResponse.text();
                  console.log(`Retry process-snapshot response (${processResponse.status}): ${processResponseText.substring(0, 500)}`);
                  
                  if (processResponse.ok) {
                    processingTriggered = true;
                  }
                } catch (err) {
                  console.error(`Retry process-snapshot failed for ${job.snapshot_id}:`, err);
                }
              }
            }
          }

        } else if (statusLower.includes("error") || statusLower.includes("failed") || statusLower.includes("aborted")) {
          failedCount++;

          await supabase
            .from("sync_jobs")
            .update({ 
              status: "failed",
              error_message: snapshot.error || "Snapshot failed or was aborted on ShipHero",
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id);

        } else {
          // Still processing on ShipHero side
          processingCount++;
          console.log(`Snapshot ${job.snapshot_id} still in progress on ShipHero: ${snapshot.status}`);
        }

        results.push({
          snapshot_id: job.snapshot_id,
          warehouse_id: job.warehouse_id,
          status: snapshot.status,
          snapshot_url: snapshot.snapshot_url,
          processing_triggered: processingTriggered,
          marked_stale: false,
          error: snapshot.error || undefined,
        });

        // Small delay between API calls
        if (activeJobs.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

      } catch (err) {
        console.error(`Error checking snapshot ${job.snapshot_id}:`, err);
        failedCount++;
        results.push({
          snapshot_id: job.snapshot_id,
          warehouse_id: job.warehouse_id,
          status: "error",
          snapshot_url: null,
          processing_triggered: false,
          marked_stale: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Build summary message
    const parts: string[] = [];
    if (completedCount > 0) parts.push(`${completedCount} completed`);
    if (processingCount > 0) parts.push(`${processingCount} still processing`);
    if (failedCount > 0) parts.push(`${failedCount} failed`);
    if (staleCount > 0) parts.push(`${staleCount} timed out`);
    const message = parts.length > 0 ? parts.join(", ") : "All jobs checked";

    return new Response(
      JSON.stringify({
        success: true,
        message,
        total_checked: activeJobs.length,
        completed: completedCount,
        still_processing: processingCount,
        failed: failedCount,
        timed_out: staleCount,
        jobs: results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error checking snapshots:", error);
    return new Response(
      JSON.stringify({ success: false, message: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
