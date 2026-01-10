-- ============================================================================
-- WAREHOUSE MANAGEMENT SYSTEM - Sync Settings Table
-- Migration: 00004_sync_settings.sql
-- Description: Stores sync schedule configuration
-- ============================================================================

-- ============================================================================
-- 1. TABLE: sync_settings
-- Purpose: Stores inventory sync schedule configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',  -- Single row config
    sync_interval_hours INT NOT NULL DEFAULT 6,
    auto_sync_enabled BOOLEAN NOT NULL DEFAULT false,
    last_sync_at TIMESTAMPTZ,
    next_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add descriptive comments
COMMENT ON TABLE sync_settings IS 'Configuration for automatic inventory synchronization';
COMMENT ON COLUMN sync_settings.sync_interval_hours IS 'Hours between automatic syncs (1-24)';
COMMENT ON COLUMN sync_settings.auto_sync_enabled IS 'Whether automatic syncing is enabled';
COMMENT ON COLUMN sync_settings.last_sync_at IS 'Timestamp of last completed sync';
COMMENT ON COLUMN sync_settings.next_sync_at IS 'Timestamp of next scheduled sync';

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_sync_settings_updated_at
    BEFORE UPDATE ON sync_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE sync_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access to authenticated users
CREATE POLICY "Allow read access to authenticated" 
    ON sync_settings 
    FOR SELECT 
    TO authenticated 
    USING (true);

-- Policy: Allow full access to service_role
CREATE POLICY "Allow full access to service_role" 
    ON sync_settings 
    FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON sync_settings TO authenticated;
GRANT ALL ON sync_settings TO service_role;

-- ============================================================================
-- 2. INSERT DEFAULT SETTINGS
-- ============================================================================

INSERT INTO sync_settings (id, sync_interval_hours, auto_sync_enabled)
VALUES ('default', 6, false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. HELPER FUNCTIONS FOR PG_CRON (Optional)
-- Note: These functions help manage scheduled sync jobs via pg_cron
-- They will fail gracefully if pg_cron is not enabled
-- ============================================================================

-- Function to schedule inventory sync job
CREATE OR REPLACE FUNCTION schedule_sync_job(cron_expression TEXT)
RETURNS VOID AS $$
BEGIN
    -- First unschedule any existing job
    PERFORM cron.unschedule('inventory_sync_job');
EXCEPTION
    WHEN undefined_function THEN
        RAISE NOTICE 'pg_cron not available';
        RETURN;
    WHEN others THEN
        NULL; -- Job might not exist, continue
END;

BEGIN
    -- Schedule the new job
    PERFORM cron.schedule(
        'inventory_sync_job',
        cron_expression,
        $$SELECT net.http_post(
            url := current_setting('app.supabase_url') || '/functions/v1/trigger-snapshot',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || current_setting('app.service_role_key')
            ),
            body := '{}'::jsonb
        )$$
    );
EXCEPTION
    WHEN undefined_function THEN
        RAISE NOTICE 'pg_cron not available';
    WHEN others THEN
        RAISE NOTICE 'Could not schedule job: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to unschedule inventory sync job
CREATE OR REPLACE FUNCTION unschedule_sync_job()
RETURNS VOID AS $$
BEGIN
    PERFORM cron.unschedule('inventory_sync_job');
EXCEPTION
    WHEN undefined_function THEN
        RAISE NOTICE 'pg_cron not available';
    WHEN others THEN
        NULL; -- Job might not exist
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update last_sync_at timestamp
CREATE OR REPLACE FUNCTION update_last_sync()
RETURNS VOID AS $$
BEGIN
    UPDATE sync_settings 
    SET last_sync_at = NOW(),
        next_sync_at = NOW() + (sync_interval_hours * INTERVAL '1 hour')
    WHERE id = 'default' AND auto_sync_enabled = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

