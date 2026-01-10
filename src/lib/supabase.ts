import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy-initialized Supabase client (prevents build-time errors)
let _supabase: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  }
  return key;
}

// Get or create Supabase client (lazy initialization)
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey());
  }
  return _supabase;
}

// Legacy export - getter that returns the lazy client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient = new Proxy({} as any, {
  get(_, prop) {
    const client = getSupabase();
    const value = client[prop as keyof SupabaseClient];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

// Edge Function URLs - lazy getters
function getEdgeFunctionUrl(name: string): string {
  return `${getSupabaseUrl()}/functions/v1/${name}`;
}

export const EDGE_FUNCTIONS = {
  get auth() { return getEdgeFunctionUrl("shiphero-auth"); },
  get triggerSnapshot() { return getEdgeFunctionUrl("trigger-snapshot"); },
  get processSnapshot() { return getEdgeFunctionUrl("process-snapshot"); },
  get updateSyncSettings() { return getEdgeFunctionUrl("update-sync-settings"); },
  get syncWarehouses() { return getEdgeFunctionUrl("sync-warehouses"); },
  get syncProducts() { return getEdgeFunctionUrl("sync-products"); },
  get checkSnapshot() { return getEdgeFunctionUrl("check-snapshot"); },
  get abortSnapshot() { return getEdgeFunctionUrl("abort-snapshot"); },
} as const;
