import { supabase, EDGE_FUNCTIONS, isSupabaseConfigured } from "./supabase";

// =============================================================================
// TYPES
// =============================================================================

export interface AuthResult {
  success: boolean;
  message: string;
  expires_at?: string;
  error?: string;
}

export interface StoredCredentials {
  has_credentials: boolean;
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: string;
  is_expired?: boolean;
  auth_type?: "oauth" | "developer";
}

// Re-export for use in components
export { isSupabaseConfigured } from "./supabase";

export interface Warehouse {
  id: string;
  shiphero_id_plain: number;
  shiphero_id_base64: string;
  name: string;
  is_active: boolean;
}

export interface InventoryPosition {
  sku: string;
  warehouse_id: number;
  bin_name: string;
  bin_id: number | null;
  quantity: number;
}

export interface SyncJob {
  id: string;
  snapshot_id: string;
  warehouse_id: number | null;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  total_items: number | null;
  processed_items: number;
  error_message: string | null;
  created_at: string;
}

// =============================================================================
// AUTHENTICATION
// =============================================================================

/**
 * Authenticate with ShipHero using username/password (OAuth flow)
 */
export async function authenticateWithCredentials(
  username: string,
  password: string
): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      message: "Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.",
      error: "config_error",
    };
  }
  try {
    const response = await fetch(EDGE_FUNCTIONS.auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || "Authentication failed",
        error: data.error,
      };
    }

    return {
      success: true,
      message: data.message || "Authentication successful",
      expires_at: data.expires_at,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Network error",
      error: "network_error",
    };
  }
}

/**
 * Authenticate with ShipHero using developer token
 */
export async function authenticateWithToken(
  developerToken: string
): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      message: "Supabase is not configured. Please set environment variables in Vercel.",
      error: "config_error",
    };
  }
  try {
    const response = await fetch(EDGE_FUNCTIONS.auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ developer_token: developerToken }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || "Authentication failed",
        error: data.error,
      };
    }

    return {
      success: true,
      message: data.message || "Developer token saved successfully",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Network error",
      error: "network_error",
    };
  }
}

/**
 * Refresh the access token using stored refresh token
 */
export async function refreshToken(): Promise<AuthResult> {
  try {
    const response = await fetch(EDGE_FUNCTIONS.auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ refresh: true }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || "Token refresh failed",
        error: data.error,
      };
    }

    return {
      success: true,
      message: "Token refreshed successfully",
      expires_at: data.expires_at,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Network error",
      error: "network_error",
    };
  }
}

/**
 * Refresh the access token using a directly provided refresh token
 * This is used when the user provides their refresh token from ShipHero
 */
export async function refreshTokenDirect(refreshTokenValue: string): Promise<AuthResult> {
  try {
    const response = await fetch(EDGE_FUNCTIONS.auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ refresh_token_direct: refreshTokenValue }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || "Token refresh failed",
        error: data.error,
      };
    }

    return {
      success: true,
      message: "Token refreshed successfully",
      expires_at: data.expires_at,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Network error",
      error: "network_error",
    };
  }
}

/**
 * Get stored credentials from Supabase
 */
export async function getStoredCredentials(): Promise<StoredCredentials> {
  if (!isSupabaseConfigured()) {
    return { has_credentials: false };
  }
  try {
    const response = await fetch(EDGE_FUNCTIONS.auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ get_credentials: true }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { has_credentials: false };
    }

    return {
      has_credentials: data.has_credentials,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      is_expired: data.is_expired,
      auth_type: data.auth_type,
    };
  } catch (error) {
    console.error("Failed to get stored credentials:", error);
    return { has_credentials: false };
  }
}

// =============================================================================
// WAREHOUSES
// =============================================================================

/**
 * Fetch all warehouses from database
 */
export async function getWarehouses(): Promise<Warehouse[]> {
  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured - returning empty warehouses");
    return [];
  }
  console.log("getWarehouses: Fetching from database...")
  const { data, error } = await supabase
    .from("warehouse_registry")
    .select("*")
    .eq("is_active", true)
    .order("name");

  console.log("getWarehouses: Result:", { data, error });

  if (error) {
    console.error("Error fetching warehouses:", error);
    return [];
  }

  if (!data || data.length === 0) {
    console.log("getWarehouses: No warehouses found");
    return [];
  }

  return data.map((w) => ({
    id: w.id,
    shiphero_id_plain: w.shiphero_id_plain,
    shiphero_id_base64: w.shiphero_id_base64,
    name: w.name,
    is_active: w.is_active,
  }));
}

/**
 * Sync warehouses from ShipHero
 */
export async function syncWarehouses(): Promise<{ success: boolean; message: string; warehouses?: { id: number; name: string }[] }> {
  try {
    const response = await fetch(EDGE_FUNCTIONS.syncWarehouses, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || "Failed to sync warehouses",
      };
    }

    return {
      success: true,
      message: data.message || "Warehouses synced successfully",
      warehouses: data.warehouses,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Network error",
    };
  }
}

// =============================================================================
// INVENTORY
// =============================================================================

/**
 * Fetch inventory for a specific warehouse
 */
export async function getInventoryByWarehouse(
  warehouseId: number
): Promise<InventoryPosition[]> {
  const { data, error } = await supabase
    .from("inventory_positions")
    .select("*")
    .eq("warehouse_id", warehouseId)
    .gt("quantity", 0)
    .order("sku");

  if (error) {
    console.error("Error fetching inventory:", error);
    return [];
  }

  return data || [];
}

/**
 * Search inventory by SKU across all warehouses
 */
export async function searchInventoryBySku(
  sku: string,
  warehouseId?: number
): Promise<InventoryPosition[]> {
  let query = supabase
    .from("inventory_positions")
    .select("*")
    .ilike("sku", `%${sku}%`)
    .gt("quantity", 0);

  if (warehouseId) {
    query = query.eq("warehouse_id", warehouseId);
  }

  const { data, error } = await query.order("sku").limit(100);

  if (error) {
    console.error("Error searching inventory:", error);
    return [];
  }

  return data || [];
}

/**
 * Get aggregated inventory items (grouped by SKU for a warehouse)
 * Now includes product names from the products table
 */
export async function getInventoryItems(warehouseId: number): Promise<{
  sku: string;
  name: string | null;
  barcode: string | null;
  totalQty: number;
  binLocations: { binName: string; qty: number }[];
}[]> {
  // Fetch all inventory items with pagination (Supabase default limit is 1000)
  const allData: Array<{
    sku: string;
    bin_name: string;
    quantity: number;
    product_name: string | null;
    barcode: string | null;
  }> = [];
  
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("inventory_with_products")
      .select("sku, bin_name, quantity, product_name, barcode")
      .eq("warehouse_id", warehouseId)
      .gt("quantity", 0)
      .order("sku")
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("Error fetching inventory items:", error);
      break;
    }

    if (data && data.length > 0) {
      allData.push(...data);
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  const data = allData;

  if (!data || data.length === 0) {
    return [];
  }

  // Group by SKU, including product info
  const skuMap = new Map<string, { 
    name: string | null;
    barcode: string | null;
    totalQty: number; 
    binLocations: { binName: string; qty: number }[] 
  }>();
  
  for (const row of data) {
    if (!skuMap.has(row.sku)) {
      skuMap.set(row.sku, { 
        name: row.product_name || null,
        barcode: row.barcode || null,
        totalQty: 0, 
        binLocations: [] 
      });
    }
    const item = skuMap.get(row.sku)!;
    item.totalQty += row.quantity;
    item.binLocations.push({ binName: row.bin_name, qty: row.quantity });
  }

  return Array.from(skuMap.entries()).map(([sku, item]) => ({
    sku,
    name: item.name,
    barcode: item.barcode,
    totalQty: item.totalQty,
    binLocations: item.binLocations,
  }));
}

/**
 * Get aggregated inventory summary by SKU
 */
export async function getInventorySummary(warehouseId?: number) {
  let query = supabase.from("inventory_summary").select("*");

  if (warehouseId) {
    query = query.eq("warehouse_id", warehouseId);
  }

  const { data, error } = await query.order("sku").limit(500);

  if (error) {
    console.error("Error fetching inventory summary:", error);
    return [];
  }

  return data || [];
}

// =============================================================================
// SYNC JOBS
// =============================================================================

/**
 * Trigger a new inventory snapshot
 * @param warehouseId - Optional: specific warehouse ID to sync (plain integer)
 */
export async function triggerInventorySnapshot(
  warehouseId?: number
): Promise<{ success: boolean; job?: SyncJob; error?: string; message?: string }> {
  try {
    console.log("Triggering snapshot for warehouse:", warehouseId || "ALL");
    
    const response = await fetch(EDGE_FUNCTIONS.triggerSnapshot, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(warehouseId ? { warehouse_id: warehouseId } : {}),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.message || "Failed to trigger snapshot",
      };
    }

    return {
      success: true,
      job: data.sync_job,
      message: data.message,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/**
 * Get sync job status
 */
export async function getSyncJobStatus(jobId: string): Promise<SyncJob | null> {
  const { data, error } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error) {
    console.error("Error fetching sync job:", error);
    return null;
  }

  return data;
}

/**
 * Get recent sync jobs
 */
export async function getRecentSyncJobs(limit = 10): Promise<SyncJob[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }
  const { data, error } = await supabase
    .from("sync_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching sync jobs:", error);
    return [];
  }

  return data || [];
}

/**
 * Check snapshot status
 */
export async function checkSnapshotStatus(snapshotId?: string): Promise<{
  success: boolean;
  status?: string;
  snapshot_url?: string;
  message?: string;
  error?: string;
}> {
  try {
    const response = await fetch(EDGE_FUNCTIONS.checkSnapshot, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(snapshotId ? { snapshot_id: snapshotId } : {}),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/**
 * Abort pending snapshot on ShipHero and cancel sync jobs
 */
export async function cancelPendingSyncJobs(): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(EDGE_FUNCTIONS.abortSnapshot, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ reason: "Cancelled by user" }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { 
        success: false, 
        message: data.message || "Failed to abort snapshot" 
      };
    }

    return { 
      success: true, 
      message: data.message || "Snapshot aborted successfully"
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to cancel jobs",
    };
  }
}

/**
 * Sync product information from ShipHero
 * @param onlyMissing - If true, only sync products that don't have names yet
 */
export async function syncProducts(onlyMissing = true): Promise<{ 
  success: boolean; 
  message: string; 
  products_synced?: number 
}> {
  try {
    console.log("Syncing products from ShipHero...");
    
    const response = await fetch(EDGE_FUNCTIONS.syncProducts, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ only_missing: onlyMissing }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { 
        success: false, 
        message: data.message || "Failed to sync products" 
      };
    }

    return { 
      success: true, 
      message: data.message || `Synced ${data.products_synced} products`,
      products_synced: data.products_synced,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to sync products",
    };
  }
}

// =============================================================================
// SYNC SETTINGS
// =============================================================================

export interface SyncSettings {
  id: string;
  sync_interval_hours: number;
  auto_sync_enabled: boolean;
  last_sync_at: string | null;
  next_sync_at: string | null;
}

/**
 * Get sync settings
 */
export async function getSyncSettings(): Promise<SyncSettings | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const { data, error } = await supabase
    .from("sync_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("Error fetching sync settings:", error);
    return null;
  }

  // Return default settings if no row exists
  if (!data) {
    return {
      id: "default",
      sync_interval_hours: 6,
      auto_sync_enabled: false,
      last_sync_at: null,
      next_sync_at: null,
    };
  }

  return data;
}

/**
 * Update sync settings
 */
export async function updateSyncSettings(
  intervalHours: number,
  autoSyncEnabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(EDGE_FUNCTIONS.updateSyncSettings, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        sync_interval_hours: intervalHours,
        auto_sync_enabled: autoSyncEnabled,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.message || "Failed to update settings",
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

