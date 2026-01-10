// =============================================================================
// SYNC PRODUCTS - Supabase Edge Function
// Syncs product information from ShipHero to the products table
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SHIPHERO_GRAPHQL_URL = "https://public-api.shiphero.com/graphql";
const BATCH_SIZE = 100; // ShipHero pagination limit

// GraphQL query to fetch products - ShipHero uses different pagination
const PRODUCTS_QUERY = `
  query GetProducts($sku: String, $has_inventory: Boolean) {
    products(sku: $sku, has_inventory: $has_inventory) {
      request_id
      complexity
      data(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            legacy_id
            sku
            name
            barcode
          }
        }
      }
    }
  }
`;

// Simpler query without pagination for now
const PRODUCTS_QUERY_SIMPLE = `
  query GetProducts {
    products {
      request_id
      complexity
      data {
        edges {
          node {
            id
            legacy_id
            sku
            name
            barcode
          }
        }
      }
    }
  }
`;

interface ProductNode {
  id: string;
  legacy_id: number;
  sku: string;
  name: string;
  barcode: string | null;
}

interface ProductsResponse {
  products: {
    request_id: string;
    complexity: number;
    data: {
      pageInfo?: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      edges: Array<{
        node: ProductNode;
      }>;
    };
  };
}

interface ProductRecord {
  sku: string;
  name: string | null;
  barcode: string | null;
  vendor_name: string | null;
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

    // Parse request body for options
    let onlyMissing = false;
    let maxPages = 50; // Default max pages to prevent infinite loops
    
    try {
      const body = await req.json();
      onlyMissing = body.only_missing === true;
      if (body.max_pages) maxPages = body.max_pages;
    } catch {
      // No body, use defaults
    }

    console.log(`Starting product sync (onlyMissing: ${onlyMissing}, maxPages: ${maxPages})`);

    // If only syncing missing products, get list of SKUs we need
    let missingSKUs: Set<string> | null = null;
    if (onlyMissing) {
      // Get unique SKUs from inventory
      const { data: inventorySKUs, error: invError } = await supabase
        .from("inventory_positions")
        .select("sku");
      
      if (invError) {
        console.error("Error fetching inventory SKUs:", invError);
      }
      
      // Get existing products
      const { data: existingProducts, error: prodError } = await supabase
        .from("products")
        .select("sku");
      
      if (prodError) {
        console.error("Error fetching existing products:", prodError);
      }
      
      const inventorySKUSet = new Set(inventorySKUs?.map(i => i.sku) || []);
      const existingSKUSet = new Set(existingProducts?.map(p => p.sku) || []);
      
      // Find SKUs in inventory that don't have products
      missingSKUs = new Set(
        Array.from(inventorySKUSet).filter(sku => !existingSKUSet.has(sku))
      );
      
      console.log(`Inventory has ${inventorySKUSet.size} unique SKUs`);
      console.log(`Products table has ${existingSKUSet.size} SKUs`);
      console.log(`Found ${missingSKUs.size} SKUs missing product info`);
      
      if (missingSKUs.size === 0) {
        // No missing SKUs - but let's sync all products anyway if products table is empty
        if (existingSKUSet.size === 0) {
          console.log("Products table is empty - syncing all products");
          onlyMissing = false;
          missingSKUs = null;
        } else {
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: "All inventory SKUs already have product info",
              products_synced: 0 
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Fetch products from ShipHero
    console.log("Fetching products from ShipHero...");

    const response = await fetch(SHIPHERO_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.access_token}`,
      },
      body: JSON.stringify({
        query: PRODUCTS_QUERY_SIMPLE,
      }),
    });

    const responseText = await response.text();
    console.log(`ShipHero response: ${responseText.substring(0, 1000)}`);
    
    if (!response.ok) {
      console.error(`ShipHero API error: ${response.status}`, responseText);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `ShipHero API error: ${response.status}`,
          details: responseText.substring(0, 500)
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = JSON.parse(responseText);

    if (result.errors) {
      console.error("GraphQL errors:", JSON.stringify(result.errors));
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "GraphQL error from ShipHero",
          errors: result.errors
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data: ProductsResponse = result.data;
    const products = data.products.data.edges;
    const allProducts: ProductRecord[] = [];
    let totalProducts = products.length;

    console.log(`Received ${totalProducts} products from ShipHero`);

    for (const edge of products) {
      const product = edge.node;
      
      // If only syncing missing, check if this SKU is needed
      if (missingSKUs && !missingSKUs.has(product.sku)) {
        continue;
      }

      allProducts.push({
        sku: product.sku,
        name: product.name || null,
        barcode: product.barcode || null,
        vendor_name: null,
      });
    }

    console.log(`Filtered to ${allProducts.length} products to sync`);

    console.log(`Fetched ${allProducts.length} products to sync`);

    // Batch upsert products
    if (allProducts.length > 0) {
      const UPSERT_BATCH_SIZE = 500;
      let upsertedCount = 0;

      for (let i = 0; i < allProducts.length; i += UPSERT_BATCH_SIZE) {
        const batch = allProducts.slice(i, i + UPSERT_BATCH_SIZE);
        
        const { error } = await supabase
          .from("products")
          .upsert(batch, { onConflict: "sku", ignoreDuplicates: false });

        if (error) {
          console.error(`Upsert error for batch ${i / UPSERT_BATCH_SIZE + 1}:`, error);
        } else {
          upsertedCount += batch.length;
        }
      }

      console.log(`Upserted ${upsertedCount} products`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Synced ${upsertedCount} products`,
          products_synced: upsertedCount,
          pages_fetched: 1,
          total_from_api: totalProducts,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "No new products to sync",
        products_synced: 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error syncing products:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: error instanceof Error ? error.message : "Internal error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

