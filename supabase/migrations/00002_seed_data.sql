-- ============================================================================
-- WAREHOUSE MANAGEMENT SYSTEM - Seed Data
-- Migration: 00002_seed_data.sql
-- Description: Initial seed data for testing and development
-- ============================================================================

-- ============================================================================
-- 1. SEED: Initial API Credentials placeholder
-- Note: Replace with actual credentials after OAuth flow
-- ============================================================================

-- Insert a placeholder record (tokens should be updated via your auth flow)
INSERT INTO api_credentials (
    access_token,
    refresh_token,
    expires_at
) VALUES (
    'placeholder_access_token',
    'placeholder_refresh_token',
    NOW() + INTERVAL '1 hour'
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. SEED: Sample Warehouses (update with your actual ShipHero warehouses)
-- ============================================================================

-- Example warehouse entries - replace with your actual ShipHero warehouse data
INSERT INTO warehouse_registry (shiphero_id_plain, shiphero_id_base64, name, is_active)
VALUES 
    -- Format: (plain_id, base64_encoded_id, 'Warehouse Name', active_status)
    -- The base64 is typically: base64_encode('Warehouse:' || plain_id)
    (1, 'V2FyZWhvdXNlOjE=', 'Primary Warehouse', true),
    (2, 'V2FyZWhvdXNlOjI=', 'Secondary Warehouse', true),
    (3, 'V2FyZWhvdXNlOjM=', 'Returns Center', true)
ON CONFLICT (shiphero_id_plain) DO UPDATE SET
    shiphero_id_base64 = EXCLUDED.shiphero_id_base64,
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- ============================================================================
-- 3. SEED: Sample Inventory Positions (for testing)
-- ============================================================================

-- Sample inventory data for testing queries
INSERT INTO inventory_positions (sku, warehouse_id, bin_name, quantity, bin_id)
VALUES
    ('SKU-001', 1, 'A-01-01', 100, 1001),
    ('SKU-001', 1, 'A-01-02', 50, 1002),
    ('SKU-001', 2, 'B-01-01', 75, 2001),
    ('SKU-002', 1, 'A-02-01', 200, 1003),
    ('SKU-002', 1, 'A-02-02', 150, 1004),
    ('SKU-003', 1, 'C-01-01', 25, 1005),
    ('SKU-003', 2, 'B-02-01', 30, 2002),
    ('SKU-003', 3, 'R-01-01', 10, 3001)
ON CONFLICT ON CONSTRAINT uq_inventory_position DO UPDATE SET
    quantity = EXCLUDED.quantity,
    bin_id = EXCLUDED.bin_id,
    updated_at = NOW();

-- ============================================================================
-- SEED DATA COMPLETE
-- ============================================================================

