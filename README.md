# Warehouse Management System (WMS) Backend

A Supabase-powered backend for warehouse management, integrated with ShipHero.

## 🏗️ Project Structure

```
├── supabase/
│   ├── migrations/
│   │   ├── 00001_initial_schema.sql    # Core database schema
│   │   ├── 00002_seed_data.sql         # Initial seed data
│   │   └── 00003_sync_jobs_table.sql   # Sync jobs tracking table
│   └── functions/
│       ├── _shared/
│       │   └── cors.ts                  # Shared CORS configuration
│       ├── shiphero-auth/
│       │   └── index.ts                 # ShipHero OAuth authentication
│       ├── trigger-snapshot/
│       │   └── index.ts                 # Trigger inventory snapshot
│       ├── process-snapshot/
│       │   └── index.ts                 # Stream & process snapshot data
│       └── deno.json                    # Deno configuration
├── env.example
└── README.md
```

## 📋 Prerequisites

- [Supabase Account](https://supabase.com)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (optional, for local development)
- ShipHero API credentials

## 🚀 Setup Instructions

### 1. Create Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Create a new project
3. Note your project URL and API keys

### 2. Enable Required Extensions

Before running migrations, enable these extensions in Supabase Dashboard:

1. Navigate to **Database → Extensions**
2. Search for and enable:
   - `pg_cron` - For scheduled database jobs
   - `pg_net` - For HTTP requests from PostgreSQL

### 3. Run Migrations

#### Option A: Via Supabase Dashboard (SQL Editor)

1. Go to **SQL Editor** in your Supabase Dashboard
2. Copy contents of `supabase/migrations/00001_initial_schema.sql`
3. Click **Run** to execute
4. Repeat for `00002_seed_data.sql`

#### Option B: Via Supabase CLI

```bash
# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Run migrations
supabase db push
```

### 4. Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy shiphero-auth
supabase functions deploy trigger-snapshot
supabase functions deploy process-snapshot

# Or deploy all at once
supabase functions deploy

# Set environment secrets (if not already set in dashboard)
supabase secrets set SHIPHERO_CLIENT_ID=your-client-id
supabase secrets set SHIPHERO_CLIENT_SECRET=your-client-secret
```

## 📊 Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `api_credentials` | OAuth tokens for ShipHero API (restricted access) |
| `warehouse_registry` | Registry of ShipHero warehouses |
| `inventory_positions` | Inventory by SKU, warehouse, and bin location |
| `sync_jobs` | Tracks inventory snapshot sync jobs |

### Row Level Security (RLS)

| Table | anon | authenticated | service_role |
|-------|------|---------------|--------------|
| `api_credentials` | ❌ DENY | ❌ DENY | ✅ FULL |
| `warehouse_registry` | ❌ DENY | 👁️ READ | ✅ FULL |
| `inventory_positions` | ❌ DENY | 👁️ READ | ✅ FULL |
| `sync_jobs` | ❌ DENY | 👁️ READ | ✅ FULL |

### Key Constraints

- `inventory_positions`: Composite unique index on `(sku, warehouse_id, bin_name)` enables efficient UPSERT operations
- `warehouse_registry`: `shiphero_id_plain` is unique

## 🔧 Database Helper Functions

### `upsert_inventory_position()`

Upsert a single inventory position:

```sql
SELECT upsert_inventory_position(
    'SKU-001',      -- p_sku
    1,              -- p_warehouse_id
    'A-01-01',      -- p_bin_name
    100,            -- p_quantity
    1001            -- p_bin_id (optional)
);
```

### `bulk_upsert_inventory_positions()`

Bulk upsert multiple inventory positions:

```sql
SELECT bulk_upsert_inventory_positions('[
    {"sku": "SKU-001", "warehouse_id": 1, "bin_name": "A-01-01", "quantity": 100},
    {"sku": "SKU-002", "warehouse_id": 1, "bin_name": "A-01-02", "quantity": 50}
]'::jsonb);
```

## 📈 Views

### `inventory_summary`

Aggregated inventory by SKU and warehouse:

```sql
SELECT * FROM inventory_summary WHERE sku = 'SKU-001';
```

---

## ⚡ Edge Functions

### `shiphero-auth`

Handles ShipHero OAuth authentication with two modes:

#### Initial Login (Username/Password)

```bash
curl -X POST 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/shiphero-auth' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -d '{
    "username": "your-shiphero-email@example.com",
    "password": "your-shiphero-password"
  }'
```

#### Token Refresh

```bash
curl -X POST 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/shiphero-auth' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -d '{
    "refresh": true
  }'
```

#### Response (Success)

```json
{
  "success": true,
  "message": "Authentication successful",
  "expires_at": "2024-01-15T12:00:00.000Z",
  "expires_in": 86400
}
```

#### Response (Auth Required)

When the refresh token is invalid or expired:

```json
{
  "error": "authentication_required",
  "message": "ShipHero authentication failed: Token expired. Manual re-authentication is required.",
  "action": "Please provide username and password for manual re-authentication."
}
```

#### Error Codes

| HTTP Status | Error Type | Description |
|-------------|------------|-------------|
| 200 | - | Success |
| 400 | `invalid_request` | Missing or invalid request body |
| 401 | `authentication_required` | Token invalid/expired, re-login needed |
| 405 | `method_not_allowed` | Only POST is allowed |
| 500 | `internal_error` | Server-side error |

#### Function Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     shiphero-auth Function                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  POST Request                                                    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────┐                                                │
│  │ Parse Body  │                                                │
│  └──────┬──────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────┐    Yes    ┌─────────────────────────┐  │
│  │ refresh: true ?     │──────────▶│ Fetch refresh_token     │  │
│  └─────────┬───────────┘           │ from api_credentials    │  │
│            │ No                     └───────────┬─────────────┘  │
│            ▼                                    │                │
│  ┌─────────────────────┐                       ▼                │
│  │ Has username/pass?  │           ┌─────────────────────────┐  │
│  └─────────┬───────────┘           │ Call ShipHero           │  │
│            │ Yes                    │ refresh_token mutation  │  │
│            ▼                        └───────────┬─────────────┘  │
│  ┌─────────────────────┐                       │                │
│  │ Call ShipHero       │                       │                │
│  │ login mutation      │                       │                │
│  └─────────┬───────────┘                       │                │
│            │                                    │                │
│            └──────────────┬────────────────────┘                │
│                           │                                      │
│                           ▼                                      │
│                  ┌────────────────────┐                         │
│                  │ UPSERT tokens to   │                         │
│                  │ api_credentials    │                         │
│                  └────────┬───────────┘                         │
│                           │                                      │
│                           ▼                                      │
│                  ┌────────────────────┐                         │
│                  │ Return 200 OK      │                         │
│                  └────────────────────┘                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### `trigger-snapshot`

Triggers ShipHero to generate an inventory snapshot and tracks the job in `sync_jobs` table.

#### Trigger Snapshot (All Warehouses)

```bash
curl -X POST 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/trigger-snapshot' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

#### Trigger Snapshot (Specific Warehouse)

```bash
curl -X POST 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/trigger-snapshot' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -d '{
    "warehouse_id": 12345
  }'
```

#### Response (Success)

```json
{
  "success": true,
  "message": "Inventory snapshot triggered successfully",
  "sync_job": {
    "id": "uuid-of-sync-job",
    "snapshot_id": "shiphero-snapshot-id",
    "request_id": "shiphero-request-id",
    "status": "pending",
    "warehouse_id": null,
    "created_at": "2024-01-15T12:00:00.000Z"
  },
  "shiphero_response": {
    "complexity": 100
  }
}
```

#### Response (Token Expired)

```json
{
  "error": "token_expired",
  "message": "Access token expired at 2024-01-15T10:00:00.000Z...",
  "action": "Call shiphero-auth with {refresh: true} to refresh the token"
}
```

#### Error Codes

| HTTP Status | Error Type | Description |
|-------------|------------|-------------|
| 200 | - | Success, snapshot triggered |
| 401 | `token_expired` | Access token expired, needs refresh |
| 401 | `no_credentials` | No stored credentials, needs initial auth |
| 405 | `method_not_allowed` | Only POST is allowed |
| 500 | `internal_error` | Server-side error |

#### Function Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    trigger-snapshot Function                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  POST Request (optional: warehouse_id)                          │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────┐                                    │
│  │ Fetch access_token from │                                    │
│  │ api_credentials table   │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐    Yes    ┌─────────────────────┐  │
│  │ Token expired?          │──────────▶│ Return 401 error    │  │
│  └───────────┬─────────────┘           │ (refresh required)  │  │
│              │ No                       └─────────────────────┘  │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │ Call ShipHero           │                                    │
│  │ inventory_generate_     │                                    │
│  │ snapshot mutation       │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │ INSERT into sync_jobs   │                                    │
│  │ with status='pending'   │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │ Return 200 OK with      │                                    │
│  │ snapshot_id & job info  │                                    │
│  └─────────────────────────┘                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### `process-snapshot`

Streams and processes ShipHero inventory snapshot files from S3, transforming nested JSON into flat inventory records.

#### Process a Snapshot

```bash
curl -X POST 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-snapshot' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -d '{
    "snapshot_url": "https://s3.amazonaws.com/shiphero-snapshots/snapshot-123.json",
    "job_id": "uuid-of-sync-job"
  }'
```

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `snapshot_url` | string | ✅ | S3 URL to the snapshot JSON file |
| `job_id` | string | ❌ | UUID of sync_job to update progress |
| `snapshot_id` | string | ❌ | ShipHero snapshot ID (for reference) |

#### Response (Success)

```json
{
  "success": true,
  "message": "Snapshot processed successfully",
  "stats": {
    "total_records": 15000,
    "batches_processed": 15,
    "skus_processed": 5000,
    "duration_seconds": 45.32
  }
}
```

#### Response (Partial Failure)

```json
{
  "success": false,
  "message": "Snapshot processing completed with errors",
  "stats": {
    "total_records": 15000,
    "batches_processed": 14,
    "skus_processed": 5000,
    "duration_seconds": 42.15
  },
  "errors": ["Batch 15 failed: connection timeout"]
}
```

#### Key Features

**1. Streaming Download**
- Fetches snapshot via HTTP stream
- Reads in chunks (doesn't load entire file into memory)
- Logs download progress for large files

**2. JSON Transformation**

Input structure (nested):

```json
{
  "SKU-001": {
    "warehouse_products": {
      "V2FyZWhvdXNlOjEyMw==": {
        "on_hand": 150,
        "item_bins": {
          "QmluOjQ1Ng==": {
            "name": "A-01-01",
            "quantity": 100
          }
        }
      }
    }
  }
}
```

Output structure (flat):

```json
{
  "sku": "SKU-001",
  "warehouse_id": 123,
  "bin_name": "A-01-01",
  "bin_id": 456,
  "quantity": 100
}
```

**3. Base64 Decoding**
- Warehouse IDs: `V2FyZWhvdXNlOjEyMw==` → `Warehouse:123` → `123`
- Bin IDs: `QmluOjQ1Ng==` → `Bin:456` → `456`
- Bin names stored as **plain text** (from `name` or `location_name` field)

**4. Batched Upserts**
- Records accumulated in batches of 1,000
- Each batch upserted to `inventory_positions` table
- Uses composite key `(sku, warehouse_id, bin_name)` for conflict resolution

**5. Progress Tracking**
- Updates `sync_jobs` table if `job_id` provided
- Tracks `total_items`, `processed_items`, status

#### Function Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    process-snapshot Function                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  POST Request (snapshot_url, job_id?)                           │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────┐                                    │
│  │ Update sync_job status  │                                    │
│  │ to 'processing'         │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │ Fetch snapshot_url      │                                    │
│  │ as HTTP stream          │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │ Parse JSON & transform  │                                    │
│  │ nested → flat records   │                                    │
│  │ • Decode Base64 IDs     │                                    │
│  │ • Extract bin_name      │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │ Batch upsert to         │◄───────┐                           │
│  │ inventory_positions     │        │                           │
│  │ (1000 records/batch)    │────────┘ Repeat                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │ Update sync_job status  │                                    │
│  │ to 'completed'/'failed' │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │ Return stats & result   │                                    │
│  └─────────────────────────┘                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Security Notes

1. **API Credentials**: The `api_credentials` table has strict RLS - only `service_role` can access it. Never expose your service role key client-side.

2. **Service Role Key**: Use the service role key only in server-side code (Edge Functions, backend services).

3. **Anon Key**: Safe for client-side use, respects RLS policies.

4. **Edge Functions**: Run server-side and automatically have access to `SUPABASE_SERVICE_ROLE_KEY` environment variable.

## 🧪 Testing Queries

```sql
-- Check warehouse registry
SELECT * FROM warehouse_registry;

-- Check inventory positions
SELECT * FROM inventory_positions;

-- View aggregated inventory
SELECT * FROM inventory_summary;

-- Test upsert function
SELECT upsert_inventory_position('TEST-SKU', 1, 'TEST-BIN', 10);

-- Check stored credentials (run as service_role)
SELECT id, expires_at, updated_at FROM api_credentials;

-- Check sync jobs status
SELECT * FROM sync_jobs_summary;

-- Get pending sync jobs
SELECT * FROM get_pending_sync_job();

-- Check specific snapshot status
SELECT * FROM get_sync_job_by_snapshot('your-snapshot-id');

-- Update sync job status (for testing)
SELECT update_sync_job_status(
    'job-uuid'::uuid,
    'completed'::sync_job_status,
    NULL,  -- error_message
    1000,  -- total_items
    1000   -- processed_items
);
```

## 📝 Development Phases

- [x] **Phase 1**: Database schema & RLS policies
- [x] **Phase 2a**: Auth Edge Function for ShipHero OAuth
- [x] **Phase 2b**: Snapshot Trigger Edge Function
- [x] **Phase 2c**: Streaming Processor Edge Function (process-snapshot)
- [ ] **Phase 3**: Poll for snapshot completion & orchestration
- [ ] **Phase 4**: Scheduled jobs with pg_cron

## 📄 License

MIT
