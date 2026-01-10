// =============================================================================
// SYNC WAREHOUSES - Supabase Edge Function
// Fetches warehouses from ShipHero and updates the warehouse_registry table
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SHIPHERO_GRAPHQL_URL = "https://public-api.shiphero.com/graphql";

// GraphQL query to fetch all warehouses
const WAREHOUSES_QUERY = `
  query GetWarehouses {
    account {
      data {
        warehouses {
          id
          legacy_id
          identifier
          dynamic_slotting
        }
      }
      request_id
    }
  }
`;

interface WarehouseResult {
  id: string;
  legacy_id: number;
  identifier: string;
  dynamic_slotting: boolean;
}

interface WarehousesQueryData {
  account: {
    data: {
      warehouses: WarehouseResult[];
    };
    request_id: string;
  };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get stored access token
    const { data: credentials, error: credError } = await supabase
      .from("api_credentials")
      .select("access_token")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (credError || !credentials?.access_token) {
      return new Response(
        JSON.stringify({ success: false, message: "No valid credentials found. Please authenticate first." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch warehouses from ShipHero
    console.log("Fetching warehouses from ShipHero...");
    
    const response = await fetch(SHIPHERO_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.access_token}`,
      },
      body: JSON.stringify({
        query: WAREHOUSES_QUERY,
        variables: {},
      }),
    });

    const responseText = await response.text();
    console.log("ShipHero response status:", response.status);
    console.log("ShipHero response:", responseText.substring(0, 1000));

    if (!response.ok) {
      console.error("ShipHero API error:", responseText);
      return new Response(
        JSON.stringify({ success: false, message: `ShipHero API error: ${response.status}`, details: responseText.substring(0, 500) }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      return new Response(
        JSON.stringify({ success: false, message: "Failed to parse ShipHero response", details: responseText.substring(0, 500) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (result.errors) {
      console.error("GraphQL errors:", JSON.stringify(result.errors));
      return new Response(
        JSON.stringify({ success: false, message: "GraphQL error", errors: result.errors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const warehousesData: WarehousesQueryData = result.data;
    const warehouses = warehousesData.account.data.warehouses;

    console.log(`Found ${warehouses.length} warehouses from ShipHero`);

    // Upsert warehouses into database
    const warehouseRecords = warehouses.map((w) => ({
      shiphero_id_plain: w.legacy_id,
      shiphero_id_base64: w.id,
      name: w.identifier || `Warehouse ${w.legacy_id}`,
      is_active: true,
    }));

    // First, mark all existing warehouses as inactive
    await supabase
      .from("warehouse_registry")
      .update({ is_active: false })
      .neq("shiphero_id_plain", 0); // Update all

    // Then upsert the fetched warehouses
    const { error: upsertError } = await supabase
      .from("warehouse_registry")
      .upsert(warehouseRecords, {
        onConflict: "shiphero_id_plain",
      });

    if (upsertError) {
      console.error("Error upserting warehouses:", upsertError);
      return new Response(
        JSON.stringify({ success: false, message: "Failed to save warehouses", error: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully synced ${warehouses.length} warehouses`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Synced ${warehouses.length} warehouses from ShipHero`,
        warehouses: warehouseRecords.map(w => ({ id: w.shiphero_id_plain, name: w.name })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error syncing warehouses:", error);
    return new Response(
      JSON.stringify({ success: false, message: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

