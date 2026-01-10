-- ============================================================================
-- WAREHOUSE MANAGEMENT SYSTEM - Initial Database Schema
-- Migration: 00001_initial_schema.sql
-- Description: Sets up core tables, RLS policies, and functions for WMS
-- ============================================================================

-- ============================================================================
-- 1. ENABLE REQUIRED EXTENSIONS
-- ============================================================================

-- pg_cron: Enables scheduled jobs (cron-like scheduling for database tasks)
-- Note: pg_cron must be enabled from Supabase Dashboard > Database > Extensions
-- This command will work if you have the necessary permissions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- pg_net: Enables HTTP requests from within PostgreSQL (for webhooks, API calls)
-- Note: pg_net must also be enabled from Supabase Dashboard > Database > Extensions
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- uuid-ossp: For generating UUIDs (usually pre-enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ============================================================================
-- 2. HELPER FUNCTION: Auto-update `updated_at` timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS 
'Trigger function to automatically update the updated_at column on row modification';

-- ============================================================================
-- 3. TABLE: api_credentials
-- Purpose: Stores OAuth tokens for ShipHero API authentication
-- Security: Highly restricted - only service_role can access
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add descriptive comments
COMMENT ON TABLE api_credentials IS 'Stores OAuth access and refresh tokens for ShipHero API';
COMMENT ON COLUMN api_credentials.id IS 'Unique identifier for the credential record';
COMMENT ON COLUMN api_credentials.access_token IS 'Current OAuth access token';
COMMENT ON COLUMN api_credentials.refresh_token IS 'OAuth refresh token for obtaining new access tokens';
COMMENT ON COLUMN api_credentials.expires_at IS 'Timestamp when the access token expires';
COMMENT ON COLUMN api_credentials.updated_at IS 'Timestamp of last update to this record';
COMMENT ON COLUMN api_credentials.created_at IS 'Timestamp when this record was created';

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_api_credentials_updated_at
    BEFORE UPDATE ON api_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owner as well (extra security)
ALTER TABLE api_credentials FORCE ROW LEVEL SECURITY;

-- Policy: DENY all access to anon role
CREATE POLICY "Deny all access to anon"
    ON api_credentials
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

-- Policy: DENY all access to authenticated role
CREATE POLICY "Deny all access to authenticated"
    ON api_credentials
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- Policy: ALLOW full access to service_role
-- Note: service_role bypasses RLS by default, but explicit policy for clarity
CREATE POLICY "Allow full access to service_role"
    ON api_credentials
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 4. TABLE: warehouse_registry
-- Purpose: Registry of all ShipHero warehouses
-- ============================================================================

CREATE TABLE IF NOT EXISTS warehouse_registry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shiphero_id_plain INT NOT NULL UNIQUE,
    shiphero_id_base64 TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add descriptive comments
COMMENT ON TABLE warehouse_registry IS 'Registry of ShipHero warehouses with their identifiers';
COMMENT ON COLUMN warehouse_registry.id IS 'Internal unique identifier';
COMMENT ON COLUMN warehouse_registry.shiphero_id_plain IS 'ShipHero warehouse ID in plain integer format';
COMMENT ON COLUMN warehouse_registry.shiphero_id_base64 IS 'ShipHero warehouse ID in base64 encoded format (used in GraphQL)';
COMMENT ON COLUMN warehouse_registry.name IS 'Human-readable warehouse name';
COMMENT ON COLUMN warehouse_registry.is_active IS 'Whether this warehouse is currently active';

-- Create index for faster lookups
CREATE INDEX idx_warehouse_registry_shiphero_id_plain 
    ON warehouse_registry(shiphero_id_plain);

CREATE INDEX idx_warehouse_registry_is_active 
    ON warehouse_registry(is_active) 
    WHERE is_active = true;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_warehouse_registry_updated_at
    BEFORE UPDATE ON warehouse_registry
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS (with permissive read access)
ALTER TABLE warehouse_registry ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access to authenticated users
CREATE POLICY "Allow read access to authenticated"
    ON warehouse_registry
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Allow full access to service_role
CREATE POLICY "Allow full access to service_role"
    ON warehouse_registry
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 5. TABLE: inventory_positions
-- Purpose: Tracks inventory quantities by SKU, warehouse, and bin location
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku TEXT NOT NULL,
    warehouse_id INT NOT NULL,
    bin_name TEXT NOT NULL,
    bin_id INT,
    quantity INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Composite unique constraint for UPSERT operations
    CONSTRAINT uq_inventory_position UNIQUE (sku, warehouse_id, bin_name),
    
    -- Foreign key to warehouse_registry
    CONSTRAINT fk_inventory_warehouse 
        FOREIGN KEY (warehouse_id) 
        REFERENCES warehouse_registry(shiphero_id_plain)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Add descriptive comments
COMMENT ON TABLE inventory_positions IS 'Inventory quantities by SKU, warehouse, and bin location';
COMMENT ON COLUMN inventory_positions.id IS 'Internal unique identifier';
COMMENT ON COLUMN inventory_positions.sku IS 'Product SKU identifier';
COMMENT ON COLUMN inventory_positions.warehouse_id IS 'Reference to warehouse (shiphero_id_plain)';
COMMENT ON COLUMN inventory_positions.bin_name IS 'Name/label of the storage bin';
COMMENT ON COLUMN inventory_positions.bin_id IS 'ShipHero bin ID (optional)';
COMMENT ON COLUMN inventory_positions.quantity IS 'Current quantity in this position';

-- Create indexes for common query patterns
CREATE INDEX idx_inventory_positions_sku 
    ON inventory_positions(sku);

CREATE INDEX idx_inventory_positions_warehouse_id 
    ON inventory_positions(warehouse_id);

CREATE INDEX idx_inventory_positions_bin_name 
    ON inventory_positions(bin_name);

-- Composite index for the unique constraint (also helps queries)
CREATE INDEX idx_inventory_positions_composite 
    ON inventory_positions(sku, warehouse_id, bin_name);

-- Partial index for non-zero quantities (common filter)
CREATE INDEX idx_inventory_positions_nonzero 
    ON inventory_positions(sku, warehouse_id) 
    WHERE quantity > 0;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_inventory_positions_updated_at
    BEFORE UPDATE ON inventory_positions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE inventory_positions ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access to authenticated users
CREATE POLICY "Allow read access to authenticated"
    ON inventory_positions
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Allow full access to service_role
CREATE POLICY "Allow full access to service_role"
    ON inventory_positions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 6. HELPER FUNCTION: Upsert inventory position
-- Purpose: Convenience function for upserting inventory data
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_inventory_position(
    p_sku TEXT,
    p_warehouse_id INT,
    p_bin_name TEXT,
    p_quantity INT,
    p_bin_id INT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO inventory_positions (sku, warehouse_id, bin_name, quantity, bin_id)
    VALUES (p_sku, p_warehouse_id, p_bin_name, p_quantity, p_bin_id)
    ON CONFLICT ON CONSTRAINT uq_inventory_position
    DO UPDATE SET
        quantity = EXCLUDED.quantity,
        bin_id = COALESCE(EXCLUDED.bin_id, inventory_positions.bin_id),
        updated_at = NOW()
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION upsert_inventory_position IS 
'Upserts an inventory position record. Updates quantity if position exists, otherwise creates new.';

-- ============================================================================
-- 7. HELPER FUNCTION: Bulk upsert inventory positions
-- Purpose: Efficiently upsert multiple inventory records at once
-- ============================================================================

CREATE OR REPLACE FUNCTION bulk_upsert_inventory_positions(
    p_positions JSONB
)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
    v_position JSONB;
BEGIN
    FOR v_position IN SELECT * FROM jsonb_array_elements(p_positions)
    LOOP
        INSERT INTO inventory_positions (
            sku, 
            warehouse_id, 
            bin_name, 
            quantity, 
            bin_id
        )
        VALUES (
            v_position->>'sku',
            (v_position->>'warehouse_id')::INT,
            v_position->>'bin_name',
            (v_position->>'quantity')::INT,
            (v_position->>'bin_id')::INT
        )
        ON CONFLICT ON CONSTRAINT uq_inventory_position
        DO UPDATE SET
            quantity = EXCLUDED.quantity,
            bin_id = COALESCE(EXCLUDED.bin_id, inventory_positions.bin_id),
            updated_at = NOW();
        
        v_count := v_count + 1;
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION bulk_upsert_inventory_positions IS 
'Bulk upserts inventory positions from a JSONB array. Returns count of processed records.';

-- ============================================================================
-- 8. VIEW: inventory_summary
-- Purpose: Aggregated view of inventory by SKU and warehouse
-- ============================================================================

CREATE OR REPLACE VIEW inventory_summary AS
SELECT 
    ip.sku,
    ip.warehouse_id,
    wr.name AS warehouse_name,
    SUM(ip.quantity) AS total_quantity,
    COUNT(DISTINCT ip.bin_name) AS bin_count,
    MAX(ip.updated_at) AS last_updated
FROM inventory_positions ip
LEFT JOIN warehouse_registry wr ON ip.warehouse_id = wr.shiphero_id_plain
GROUP BY ip.sku, ip.warehouse_id, wr.name;

COMMENT ON VIEW inventory_summary IS 
'Aggregated inventory summary by SKU and warehouse';

-- ============================================================================
-- 9. GRANT PERMISSIONS
-- ============================================================================

-- Grant usage on schema to roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Grant necessary permissions to service_role (full access)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Grant read permissions to authenticated users where appropriate
GRANT SELECT ON warehouse_registry TO authenticated;
GRANT SELECT ON inventory_positions TO authenticated;
GRANT SELECT ON inventory_summary TO authenticated;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Add migration tracking comment
COMMENT ON SCHEMA public IS 'WMS Schema - Migration 00001 applied';

