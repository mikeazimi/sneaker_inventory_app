import { createClient } from "@supabase/supabase-js";

// These will be set from environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Create Supabase client for frontend use
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Edge Function URLs
export const EDGE_FUNCTIONS = {
  auth: `${supabaseUrl}/functions/v1/shiphero-auth`,
  triggerSnapshot: `${supabaseUrl}/functions/v1/trigger-snapshot`,
  processSnapshot: `${supabaseUrl}/functions/v1/process-snapshot`,
  updateSyncSettings: `${supabaseUrl}/functions/v1/update-sync-settings`,
  syncWarehouses: `${supabaseUrl}/functions/v1/sync-warehouses`,
  syncProducts: `${supabaseUrl}/functions/v1/sync-products`,
  checkSnapshot: `${supabaseUrl}/functions/v1/check-snapshot`,
  abortSnapshot: `${supabaseUrl}/functions/v1/abort-snapshot`,
} as const;

