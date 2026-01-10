// =============================================================================
// UPDATE SYNC SETTINGS - Supabase Edge Function
// Updates sync schedule settings and configures pg_cron job
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Types
interface SyncSettingsRequest {
  sync_interval_hours: number;
  auto_sync_enabled: boolean;
}

// Initialize Supabase client with service role
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Convert hours to cron expression
function hoursToCron(hours: number): string {
  // Run at minute 0, every N hours
  if (hours === 1) return "0 * * * *"; // Every hour
  if (hours === 24) return "0 0 * * *"; // Once a day at midnight
  return `0 */${hours} * * *`; // Every N hours
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only allow POST
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, message: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: SyncSettingsRequest = await req.json();
    const { sync_interval_hours, auto_sync_enabled } = body;

    // Validate input
    if (typeof sync_interval_hours !== "number" || sync_interval_hours < 1 || sync_interval_hours > 24) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid sync interval. Must be between 1 and 24 hours." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate next sync time
    const now = new Date();
    const nextSyncAt = auto_sync_enabled 
      ? new Date(now.getTime() + sync_interval_hours * 60 * 60 * 1000)
      : null;

    // Upsert sync settings
    const { error: upsertError } = await supabase
      .from("sync_settings")
      .upsert({
        id: "default", // Single row for settings
        sync_interval_hours,
        auto_sync_enabled,
        next_sync_at: nextSyncAt?.toISOString() || null,
        updated_at: now.toISOString(),
      }, {
        onConflict: "id",
      });

    if (upsertError) {
      console.error("Error upserting sync settings:", upsertError);
      return new Response(
        JSON.stringify({ success: false, message: "Failed to save settings", error: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update pg_cron job if available
    // Note: This requires pg_cron extension to be enabled
    if (auto_sync_enabled) {
      const cronExpression = hoursToCron(sync_interval_hours);
      
      try {
        // First, try to unschedule any existing job
        await supabase.rpc("unschedule_sync_job").catch(() => {
          // Ignore if function doesn't exist or job doesn't exist
        });

        // Schedule new job
        await supabase.rpc("schedule_sync_job", {
          cron_expression: cronExpression,
        }).catch((err) => {
          console.warn("Could not schedule pg_cron job:", err);
          // Continue anyway - manual sync still works
        });
      } catch (cronError) {
        console.warn("pg_cron scheduling skipped:", cronError);
      }
    } else {
      // Disable auto-sync: unschedule the job
      try {
        await supabase.rpc("unschedule_sync_job").catch(() => {
          // Ignore if function doesn't exist
        });
      } catch (cronError) {
        console.warn("pg_cron unscheduling skipped:", cronError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Sync settings updated successfully",
        settings: {
          sync_interval_hours,
          auto_sync_enabled,
          next_sync_at: nextSyncAt?.toISOString() || null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in update-sync-settings:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

