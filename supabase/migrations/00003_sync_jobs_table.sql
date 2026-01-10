-- ============================================================================
-- WAREHOUSE MANAGEMENT SYSTEM - Sync Jobs Table
-- Migration: 00003_sync_jobs_table.sql
-- Description: Tracks inventory snapshot synchronization jobs
-- ============================================================================

-- ============================================================================
-- 1. CREATE ENUM FOR JOB STATUS
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE sync_job_status AS ENUM (
        'pending',      -- Snapshot requested, awaiting processing
        'processing',   -- Currently fetching snapshot data
        'completed',    -- Successfully synced all data
        'failed',       -- Job failed (see error_message)
        'cancelled'     -- Job was cancelled
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. TABLE: sync_jobs
-- Purpose: Tracks inventory snapshot generation and processing jobs
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- ShipHero snapshot identifiers
    snapshot_id TEXT NOT NULL,
    job_id TEXT,                        -- ShipHero job ID (if different from snapshot_id)
    
    -- Job configuration
    warehouse_id INT,                   -- Optional: specific warehouse filter
    
    -- Job status tracking
    status sync_job_status NOT NULL DEFAULT 'pending',
    error_message TEXT,
    
    -- Progress tracking
    total_items INT,                    -- Total items in snapshot (when known)
    processed_items INT DEFAULT 0,      -- Items processed so far
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,             -- When processing began
    completed_at TIMESTAMPTZ,           -- When job finished (success or failure)
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add descriptive comments
COMMENT ON TABLE sync_jobs IS 'Tracks inventory snapshot synchronization jobs from ShipHero';
COMMENT ON COLUMN sync_jobs.snapshot_id IS 'ShipHero snapshot ID returned from inventory_generate_snapshot';
COMMENT ON COLUMN sync_jobs.job_id IS 'ShipHero job ID (may differ from snapshot_id in some cases)';
COMMENT ON COLUMN sync_jobs.warehouse_id IS 'Filter: specific warehouse ID if snapshot was warehouse-specific';
COMMENT ON COLUMN sync_jobs.status IS 'Current job status: pending, processing, completed, failed, cancelled';
COMMENT ON COLUMN sync_jobs.error_message IS 'Error details if job failed';
COMMENT ON COLUMN sync_jobs.total_items IS 'Total number of items in the snapshot';
COMMENT ON COLUMN sync_jobs.processed_items IS 'Number of items processed so far';
COMMENT ON COLUMN sync_jobs.started_at IS 'Timestamp when job processing began';
COMMENT ON COLUMN sync_jobs.completed_at IS 'Timestamp when job completed (success or failure)';

-- Create indexes for common query patterns
CREATE INDEX idx_sync_jobs_status 
    ON sync_jobs(status);

CREATE INDEX idx_sync_jobs_snapshot_id 
    ON sync_jobs(snapshot_id);

CREATE INDEX idx_sync_jobs_created_at 
    ON sync_jobs(created_at DESC);

CREATE INDEX idx_sync_jobs_pending 
    ON sync_jobs(created_at) 
    WHERE status = 'pending';

CREATE INDEX idx_sync_jobs_processing 
    ON sync_jobs(started_at) 
    WHERE status = 'processing';

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_sync_jobs_updated_at
    BEFORE UPDATE ON sync_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access to authenticated users
CREATE POLICY "Allow read access to authenticated"
    ON sync_jobs
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Allow full access to service_role
CREATE POLICY "Allow full access to service_role"
    ON sync_jobs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON sync_jobs TO authenticated;
GRANT ALL ON sync_jobs TO service_role;

-- ============================================================================
-- 3. HELPER FUNCTIONS FOR SYNC JOBS
-- ============================================================================

-- Function to create a new sync job
CREATE OR REPLACE FUNCTION create_sync_job(
    p_snapshot_id TEXT,
    p_warehouse_id INT DEFAULT NULL,
    p_job_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO sync_jobs (snapshot_id, warehouse_id, job_id, status)
    VALUES (p_snapshot_id, p_warehouse_id, p_job_id, 'pending')
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update sync job status
CREATE OR REPLACE FUNCTION update_sync_job_status(
    p_job_id UUID,
    p_status sync_job_status,
    p_error_message TEXT DEFAULT NULL,
    p_total_items INT DEFAULT NULL,
    p_processed_items INT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE sync_jobs
    SET 
        status = p_status,
        error_message = COALESCE(p_error_message, error_message),
        total_items = COALESCE(p_total_items, total_items),
        processed_items = COALESCE(p_processed_items, processed_items),
        started_at = CASE 
            WHEN p_status = 'processing' AND started_at IS NULL THEN NOW()
            ELSE started_at
        END,
        completed_at = CASE 
            WHEN p_status IN ('completed', 'failed', 'cancelled') THEN NOW()
            ELSE completed_at
        END,
        updated_at = NOW()
    WHERE id = p_job_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get the latest pending job
CREATE OR REPLACE FUNCTION get_pending_sync_job()
RETURNS TABLE (
    id UUID,
    snapshot_id TEXT,
    warehouse_id INT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT sj.id, sj.snapshot_id, sj.warehouse_id, sj.created_at
    FROM sync_jobs sj
    WHERE sj.status = 'pending'
    ORDER BY sj.created_at ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get job by snapshot_id
CREATE OR REPLACE FUNCTION get_sync_job_by_snapshot(p_snapshot_id TEXT)
RETURNS TABLE (
    id UUID,
    snapshot_id TEXT,
    job_id TEXT,
    warehouse_id INT,
    status sync_job_status,
    error_message TEXT,
    total_items INT,
    processed_items INT,
    created_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sj.id, sj.snapshot_id, sj.job_id, sj.warehouse_id,
        sj.status, sj.error_message, sj.total_items, sj.processed_items,
        sj.created_at, sj.started_at, sj.completed_at
    FROM sync_jobs sj
    WHERE sj.snapshot_id = p_snapshot_id
    ORDER BY sj.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. VIEW: sync_jobs_summary
-- Purpose: Summary view of recent sync jobs
-- ============================================================================

CREATE OR REPLACE VIEW sync_jobs_summary AS
SELECT 
    id,
    snapshot_id,
    warehouse_id,
    status,
    total_items,
    processed_items,
    CASE 
        WHEN total_items > 0 THEN 
            ROUND((processed_items::NUMERIC / total_items::NUMERIC) * 100, 2)
        ELSE 0
    END AS progress_percent,
    error_message,
    created_at,
    started_at,
    completed_at,
    CASE 
        WHEN completed_at IS NOT NULL AND started_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (completed_at - started_at))::INT
        WHEN started_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (NOW() - started_at))::INT
        ELSE NULL
    END AS duration_seconds
FROM sync_jobs
ORDER BY created_at DESC;

COMMENT ON VIEW sync_jobs_summary IS 'Summary view of sync jobs with progress calculation';

GRANT SELECT ON sync_jobs_summary TO authenticated;
GRANT SELECT ON sync_jobs_summary TO service_role;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

