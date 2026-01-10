-- =============================================================================
-- PRODUCTS TABLE
-- Stores product information synced from ShipHero
-- =============================================================================

-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku TEXT UNIQUE NOT NULL,
  name TEXT,
  barcode TEXT,
  vendor_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

-- Add trigger for updated_at
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS policies
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Allow read access to anon (for frontend)
CREATE POLICY "Allow read access to anon" ON products
  FOR SELECT TO anon USING (true);

-- Allow read access to authenticated users
CREATE POLICY "Allow read access to authenticated" ON products
  FOR SELECT TO authenticated USING (true);

-- Allow full access to service_role (for Edge Functions)
CREATE POLICY "Allow full access to service_role" ON products
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- VIEW: inventory_with_products
-- Joins inventory_positions with products for easy querying
-- =============================================================================

CREATE OR REPLACE VIEW inventory_with_products AS
SELECT 
  ip.sku,
  ip.warehouse_id,
  ip.bin_name,
  ip.bin_id,
  ip.quantity,
  p.name as product_name,
  p.barcode,
  p.vendor_name
FROM inventory_positions ip
LEFT JOIN products p ON ip.sku = p.sku;

-- Grant access to the view
GRANT SELECT ON inventory_with_products TO anon;
GRANT SELECT ON inventory_with_products TO authenticated;
GRANT SELECT ON inventory_with_products TO service_role;

