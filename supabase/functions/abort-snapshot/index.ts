// =============================================================================
// ABORT SNAPSHOT - Supabase Edge Function
// Aborts a pending ShipHero inventory snapshot
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SHIPHERO_GRAPHQL_URL = "https://public-api.shiphero.com/graphql";

// Using inline variables since ShipHero might not support variable substitution in data object
const createAbortMutation = (snapshotId: string, reason: string) => `
  mutation {
    inventory_abort_snapshot(
      data: { snapshot_id: "${snapshotId}", reason: "${reason}" }
    ) {
      request_id
      complexity
      snapshot {
        snapshot_id
        status
        error
      }
    }
  }
`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get snapshot_id from request or get latest pending job
    let snapshotId: string | null = null;
    let reason = "Cancelled by user";
    
    try {
      const body = await req.json();
      snapshotId = body.snapshot_id;
      reason = body.reason || reason;
    } catch {
      // No body provided
    }

    if (!snapshotId) {
      // Get the most recent pending sync job
      const { data: pendingJob } = await supabase
        .from("sync_jobs")
        .select("snapshot_id")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (pendingJob) {
        snapshotId = pendingJob.snapshot_id;
      }
    }

    if (!snapshotId) {
      return new Response(
        JSON.stringify({ success: false, message: "No pending snapshots found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Call ShipHero to abort the snapshot
    console.log("Aborting snapshot:", snapshotId);
    
    const mutation = createAbortMutation(snapshotId, reason);
    console.log("Mutation:", mutation);
    
    const response = await fetch(SHIPHERO_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.access_token}`,
      },
      body: JSON.stringify({
        query: mutation,
      }),
    });

    const responseText = await response.text();
    console.log("ShipHero response:", responseText.substring(0, 1000));

    if (!response.ok) {
      return new Response(
        JSON.stringify({ success: false, message: `ShipHero API error: ${response.status}`, details: responseText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = JSON.parse(responseText);

    if (result.errors) {
      console.error("GraphQL errors:", result.errors);
      const errorMessage = result.errors[0]?.message || "GraphQL error";
      console.log("Error message:", errorMessage);
      
      // If ShipHero says it's already processing, still mark as cancelled in our DB
      // so user can trigger a new snapshot
      const isAlreadyProcessing = errorMessage.toLowerCase().includes("already") || 
          errorMessage.toLowerCase().includes("process") ||
          errorMessage.toLowerCase().includes("cannot abort");
      
      console.log("Is already processing?", isAlreadyProcessing);
      
      if (isAlreadyProcessing) {
        console.log("ShipHero won't abort, marking as cancelled in our DB for snapshot:", snapshotId);
        
        const { error: updateError } = await supabase
          .from("sync_jobs")
          .update({ 
            status: "cancelled",
            error_message: `ShipHero: ${errorMessage}. Marked as cancelled locally.`,
            completed_at: new Date().toISOString(),
          })
          .eq("snapshot_id", snapshotId);

        if (updateError) {
          console.error("Failed to update sync_jobs:", updateError);
        } else {
          console.log("Successfully marked as cancelled in DB");
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Marked as cancelled (ShipHero snapshot still processing in background)",
            snapshot_id: snapshotId,
            note: "You can now trigger a new snapshot. The old one will complete in the background."
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: false, message: errorMessage, errors: result.errors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update our database
    await supabase
      .from("sync_jobs")
      .update({ 
        status: "cancelled",
        error_message: reason,
        completed_at: new Date().toISOString(),
      })
      .eq("snapshot_id", snapshotId);

    const snapshot = result.data?.inventory_abort_snapshot?.snapshot;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Snapshot aborted successfully",
        snapshot_id: snapshotId,
        status: snapshot?.status || "cancelled",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error aborting snapshot:", error);
    return new Response(
      JSON.stringify({ success: false, message: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

