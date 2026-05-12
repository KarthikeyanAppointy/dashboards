# Background SLO Dashboard

A multi-tenant monitoring dashboard for Cadence/Temporal workflow rates, success/failure metrics, and tasklist latency. Built with a **Go** backend and **React** frontend, streaming data from **Elasticsearch** every 5 seconds.

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│   React UI   │────▶│  Go Backend  │────▶│  Elasticsearch  │
│  (port 5173) │     │  (port 8080) │     │  (per tenant)   │
└──────────────┘     └──────┬───────┘     └─────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  PostgreSQL  │
                     │   (tenants)  │
                     └──────────────┘
```

- **Go Backend** — queries Elasticsearch via `_msearch` (batch API), stores tenant configurations in PostgreSQL
- **React Frontend** — auto-refreshes every 5s, shows summary cards, workflow rate tables, tasklist latency, and recent failures
- **PostgreSQL** — stores multi-tenant configurations (ES endpoints, domain IDs, etc.)
- **Elasticsearch** — Cadence/Temporal visibility index (read-only)

---

## Prerequisites

- Go 1.21+
- Node.js 18+
- Docker & Docker Compose (for PostgreSQL)
- A running Elasticsearch instance with Cadence/Temporal visibility index

---

## Quick Start

### 1. Start PostgreSQL

```bash
cd /Users/spidey/saastack/internal-scripts/slo_dashboard
docker compose up -d
```

This starts PostgreSQL 16 on port 5432 with database `slo_dashboard` (user: `postgres`, password: `postgres`).

### 2. Start the Go Backend

```bash
cd /Users/spidey/saastack/internal-scripts/slo_dashboard/backend

# Seed a default tenant and start
DEFAULT_TENANT_NAME="qa-mathnasium" \
DEFAULT_DOMAIN_ID="e8e74cad-6971-4a5d-8752-e2477531ab68" \
DEFAULT_DOMAIN_NAME="qa-mathnasium" \
DEFAULT_ES="http://localhost:9000" \
go run main.go
```

The backend starts on `http://localhost:8080`.

### 3. Start the React Frontend

```bash
cd /Users/spidey/saastack/internal-scripts/slo_dashboard/frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Environment Variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/slo_dashboard?sslmode=disable` | PostgreSQL connection string |
| `PORT` | `8080` | HTTP listen port |
| `DEFAULT_TENANT_NAME` | `Default` | Name for auto-seeded default tenant |
| `DEFAULT_DOMAIN_ID` | (empty) | Domain UUID for auto-seeded tenant |
| `DEFAULT_DOMAIN_NAME` | `unknown` | Domain display name |
| `DEFAULT_ES` | `http://localhost:9000` | ES endpoint for auto-seeded tenant |
| `DEFAULT_INDEX` | `cadence-visibility` | ES index for auto-seeded tenant |

> **Note:** If the `tenants` table is empty on startup, the backend auto-creates a default tenant using the `DEFAULT_*` env vars. If tenants already exist, it uses those instead.

---

## API Endpoints

### Health Check

```bash
curl http://localhost:8080/health
```

Response:
```json
{"status":"ok"}
```

### List Tenants

```bash
curl http://localhost:8080/api/tenants
```

Response:
```json
[
  {
    "id": 1,
    "name": "qa-mathnasium",
    "domain_id": "e8e74cad-6971-4a5d-8752-e2477531ab68",
    "domain_name": "qa-mathnasium",
    "es_endpoint": "http://localhost:9000",
    "es_index": "cadence-visibility",
    "created_at": "2025-05-12T10:30:00Z",
    "updated_at": "2025-05-12T10:30:00Z"
  }
]
```

### Add a Tenant

```bash
curl -X POST http://localhost:8080/api/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "appointyx-prod",
    "domain_id": "0d2b250f-9298-49e9-ac2e-58b0c361b816",
    "domain_name": "appointyx-prod",
    "es_endpoint": "http://localhost:9200",
    "es_index": "cadence-visibility"
  }'
```

**Explanation of each field:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ Yes | Human-readable tenant name (shown in the UI dropdown) |
| `domain_id` | ✅ Yes | Cadence/Temporal Domain UUID. To find yours: `kubectl exec <cadence-pod> -- cadence --domain <name> domain describe` and copy the UUID |
| `domain_name` | ✅ Yes | Human-readable domain name for display |
| `es_endpoint` | ❌ No (defaults to `http://localhost:9000`) | Elasticsearch HTTP endpoint |
| `es_index` | ❌ No (defaults to `cadence-visibility`) | Elasticsearch index name containing workflow visibility data |

Response (201 Created):
```json
{
  "id": 2,
  "name": "appointyx-prod",
  "domain_id": "0d2b250f-9298-49e9-ac2e-58b0c361b816",
  "domain_name": "appointyx-prod",
  "es_endpoint": "http://localhost:9200",
  "es_index": "cadence-visibility",
  "created_at": "2025-05-12T11:00:00Z",
  "updated_at": "2025-05-12T11:00:00Z"
}
```

### Delete a Tenant

```bash
curl -X DELETE "http://localhost:8080/api/tenants/delete?id=2"
```

Response:
```json
{"status":"deleted"}
```

### Get Workflow Dashboard Data

```bash
# Get data for a specific tenant
curl "http://localhost:8080/api/workflows?tenant_id=1"

# With custom limit for recent failures
curl "http://localhost:8080/api/workflows?tenant_id=1&limit=100"

# With custom tasklist latency window (in seconds)
curl "http://localhost:8080/api/workflows?tenant_id=1&limit=50&tasklist_window=10800"

# All params together
curl "http://localhost:8080/api/workflows?tenant_id=1&limit=500&tasklist_window=86400"
```

**Query Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `tenant_id` | First tenant | Tenant ID to query |
| `limit` | `20` | Max recent failed/timed-out workflows to return (1–500) |
| `tasklist_window` | `3600` | Time window in seconds for tasklist latency aggregation (300–86400) |

**Response structure:**
```json
{
  "domain_name": "qa-mathnasium",
  "tenant_id": 1,
  "timestamp": "2025-05-12 11:30:00",
  "windows": [
    {"label": "Last 10s", "seconds": 10, "started": 150, "completed": 120, "failed": 5, "timed_out": 3, "cancelled": 2, "open": 20, ...},
    {"label": "Last 30s", "seconds": 30, ...},
    {"label": "Last 60s", "seconds": 60, ...},
    {"label": "Last 5min", "seconds": 300, ...},
    {"label": "Last 30min", "seconds": 1800, ...},
    {"label": "Last 1hr", "seconds": 3600, ...},
    {"label": "Last 1d", "seconds": 86400, ...},
    {"label": "Last 7d", "seconds": 604800, ...},
    {"label": "Last 30d", "seconds": 2592000, ...}
  ],
  "rates_30min": {"success_pct": "98.2", "failure_pct": "1.8", "total": 5000, "success": 4910, "failure": 90},
  "rates_1hr":  {"success_pct": "97.5", "failure_pct": "2.5", "total": 10000, "success": 9750, "failure": 250},
  "rates_1d":   {"success_pct": "99.1", "failure_pct": "0.9", "total": 240000, "success": 237840, "failure": 2160},
  "rates_7d":   {"success_pct": "99.3", "failure_pct": "0.7", "total": 1680000, "success": 1668240, "failure": 11760},
  "rates_30d":  {"success_pct": "99.5", "failure_pct": "0.5", "total": 7200000, "success": 7164000, "failure": 36000},
  "recent_failed": [
    {"workflow_id": "wf-abc-123", "workflow_type": "SomeWorkflow", "status": "Failed", "close_time": "2025-05-12 11:29:30"},
    {"workflow_id": "wf-def-456", "workflow_type": "OtherWorkflow", "status": "TimedOut", "close_time": "2025-05-12 11:28:45"}
  ],
  "tasklist_latency": [
    {"tasklist": "main-tasklist", "avg_latency_ms": 1234.5, "workflow_count": 100},
    {"tasklist": "worker-queue", "avg_latency_ms": 567.8, "workflow_count": 50}
  ]
}
```

---

## Dashboard Features

### Summary Cards
Shows success/failure percentage and breakdown for 5 time windows:
- Last 30 Minutes
- Last 1 Hour
- Last 24 Hours
- Last 7 Days
- Last 30 Days

### Workflow Rates Table
Displays counts and rates (per second) across 9 time windows for:
- Started (total workflows)
- Completed (CloseStatus = 0)
- Failed (CloseStatus = 1)
- Timed Out (CloseStatus = 5)
- Cancelled / ContinuedAsNew (CloseStatus = 4)
- Open (workflows without CloseTime)

### Tasklist Average Latency
Shows average duration `(CloseTime - StartTime)` in milliseconds for completed workflows, grouped by TaskList. The time window can be toggled between:
- Last 1h
- Last 3h
- Last 6h
- Last 12h
- Last 1d

Each row includes a visual bar proportional to the maximum latency.

### Recent Failed / Timed Out Workflows
Shows the most recent failed workflows (prioritized), backfilled with timed-out workflows. The count can be toggled between:
- 20, 50, 100, 200, 500

### Tenant Selector
Switch between tenants using the dropdown in the top-right header. The selected tenant persists in `localStorage`.

---

## Data Explained

All categories use **`StartTime`** as the filter — meaning "workflows that _started_ in that window."

- **Started**: workflows whose `StartTime` is within the window
- **Completed**: workflows whose `StartTime` is within the window **AND** `CloseStatus=0`
- **Failed**: workflows whose `StartTime` is within the window **AND** `CloseStatus=1`
- **Failure** (summary cards) = Failed + Timed Out
- **Success** (summary cards) = Started - Failure

This is the correct way to measure success rate — "of all workflows that started in the last hour, what percentage completed successfully?"

---

## Development

### Project Structure

```
slo_dashboard/
├── docker-compose.yml          # PostgreSQL container
├── README.md
├── backend/
│   ├── go.mod
│   └── main.go                 # Single-file Go backend (~1050 lines)
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── App.css
        └── components/
            ├── SummaryCards.jsx / .css
            ├── WorkflowTable.jsx / .css
            ├── RecentFailures.jsx / .css
            ├── TasklistLatency.jsx / .css
            └── TenantSelector.jsx / .css
```

### Building

```bash
# Backend
cd backend && go build -o slo-dashboard-backend .

# Frontend
cd frontend && npx vite build
```
