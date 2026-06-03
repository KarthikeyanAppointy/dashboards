# Background SLO Dashboard

A multi-tenant monitoring dashboard for Cadence/Temporal workflow rates, success/failure metrics, and tasklist latency. Built with a **Go** backend and **React** frontend, streaming data from **Elasticsearch** every 5 seconds.

For a zero-context local setup guide, start with the runbook:

- [Local Setup Runbook](docs/local-setup-runbook.md)

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│   React UI   │────▶│  Go Backend  │────▶│  Elasticsearch  │
│  (port 5173) │     │  (port 8081) │     │  (per tenant)   │
└──────────────┘     └──────┬───────┘     └─────────────────┘
                            │
                            ├──────────────────────────────────┐
                            │                                  │
                            ▼                                  ▼
                     ┌──────────────┐              ┌──────────────────┐
                     │  PostgreSQL  │              │  AWS CloudWatch  │
                     │   (tenants)  │              │  (SES metrics)   │
                     └──────────────┘              └──────────────────┘
```

- **Go Backend** — queries Elasticsearch via `_msearch` (batch API) for workflow metrics, queries AWS CloudWatch for SES delivery metrics, stores tenant configurations in PostgreSQL
- **React Frontend** — auto-refreshes every 5s, shows summary cards, workflow rate tables, tasklist latency, recent failures, and SES delivery metrics (bounce/complaint/error rates)
- **PostgreSQL** — stores multi-tenant configurations (ES endpoints, domain IDs, etc.)
- **Elasticsearch** — Cadence/Temporal visibility index (read-only)

---

## Prerequisites

- Go 1.21+
- Node.js 18+
- Docker & Docker Compose (for PostgreSQL)
- A running Elasticsearch instance with Cadence/Temporal visibility index
- AWS credentials with CloudWatch read access for SES metrics (if using the SES dashboard)

---

## Quick Start

### 1. Start PostgreSQL

```bash
cd background-slo
docker compose up -d
```

This starts PostgreSQL 16 on port 5432 with database `slo_dashboard` (user: `postgres`, password: `postgres`).

### 2. Start the Go Backend

```bash
cd background-slo/backend

export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/slo_dashboard?sslmode=disable"
export PORT="8081"
export GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
export APPONTY_ONLY_LOGIN="false"
export ADMIN_KEY="local-admin-key"

go run main.go
```

The backend starts on `http://localhost:8081`.

Use environment variables here only for app-wide backend settings such as:
- database connection
- backend port
- Google token audience validation
- one-time admin bootstrap key

You do not need `DEFAULT_TENANT_NAME`, `DEFAULT_DOMAIN_ID`, `DEFAULT_DOMAIN_NAME`, `DEFAULT_ES`, or `DEFAULT_INDEX` to start `main.go` for normal local development.

Do not use backend env vars for normal tenant/client configuration. Tenant fields such as domain, Elasticsearch endpoint, index, and Cadence Web URL should be created and edited from the **Clients** page in the UI.

### 3. Start the React Frontend

```bash
cd background-slo/frontend
export VITE_GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
export VITE_APPONTY_ONLY_LOGIN="false"
npm run dev
```

Open **http://localhost:5173** in your browser.

### 4. Sign In

Open the app and sign in with Google using the same account you want to make admin.

### 5. Bootstrap the First Admin

After signing in once, bootstrap the first admin from another terminal:

```bash
curl -X POST http://localhost:8081/api/rbac/setup-admin \
  -H "Content-Type: application/json" \
  -d '{
    "admin_key": "local-admin-key",
    "user_email": "your-email@example.com"
  }'
```

Important:
- `user_email` must be the same account that already signed in to the UI
- `admin_key` must match the backend `ADMIN_KEY`
- this is a one-time bootstrap path for the first admin

### 6. Create a Client from the UI

After the admin bootstrap succeeds:
- refresh the UI if needed
- open **Clients**
- click **Add Client**
- enter the tenant-specific values there

By default, the **ES Endpoint** field uses:

```text
http://localhost:9000
```

This is the recommended place to configure:
- client name
- domain ID
- domain name
- Elasticsearch endpoint
- Elasticsearch index
- audience URL
- NotifyHub settings
- Cadence Web URL

---

## Environment Variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/slo_dashboard?sslmode=disable` | PostgreSQL connection string |
| `PORT` | `8081` | HTTP listen port |
| `GOOGLE_CLIENT_ID` | _(empty)_ | Google OAuth client ID for token audience verification (skips check if empty) |
| `APPONTY_ONLY_LOGIN` | `true` | Restrict sign-in to `@appointy.com` users unless set to `false` |
| `ADMIN_KEY` | _(empty)_ | One-time first-admin bootstrap key used by `POST /api/rbac/setup-admin` |
| `AWS_REGION` | `us-east-1` | AWS region for CloudWatch SES metric queries |
| `SES_REGIONS` | _(single region from `AWS_REGION`)_ | Comma-separated list of AWS regions for the SES region dropdown (e.g. `us-east-1,us-west-2,eu-west-1`) |
| `SES_CONFIG_SET_NAME` | _(empty)_ | Optional SES configuration set name to filter metrics by |
| `SES_DOMAIN_NAME` | `ses` | Display name shown in the SES dashboard header |
| `DEFAULT_TENANT_NAME` | `Default` | Optional bootstrap tenant name when the DB has no tenants |
| `DEFAULT_DOMAIN_ID` | (empty) | Optional bootstrap domain UUID |
| `DEFAULT_DOMAIN_NAME` | `unknown` | Optional bootstrap domain display name |
| `DEFAULT_ES` | `http://localhost:9000` | Optional bootstrap ES endpoint |
| `DEFAULT_INDEX` | `cadence-visibility` | Optional bootstrap ES index |
| `DEFAULT_CADENCE_WEB_URL` | _(empty)_ | Optional bootstrap Cadence Web URL |

> **Note:** AWS credentials are resolved using the standard AWS SDK credential chain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` environment variables, shared credentials file, or IAM roles when running on EC2/ECS).
>
> **Note:** The `DEFAULT_*` variables are only for optional bootstrap behavior when the database has no tenants yet. In normal usage, create and manage tenant/client configuration from the **Clients** page.

---

## API Endpoints

### Health Check

```bash
curl http://localhost:8081/health
```

Response:
```json
{"status":"ok"}
```

### List Tenants

```bash
curl http://localhost:8081/api/tenants
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
curl -X POST http://localhost:8081/api/tenants \
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
curl -X DELETE "http://localhost:8081/api/tenants/delete?id=2"
```

Response:
```json
{"status":"deleted"}
```

### Get SES Delivery Metrics

```bash
# Get SES metrics for the last 7 days (default)
curl "http://localhost:8081/api/ses-metrics"

# Get SES metrics for the last 30 days
curl "http://localhost:8081/api/ses-metrics?days=30"

# Get SES metrics for a custom time range (Unix timestamps)
curl "http://localhost:8081/api/ses-metrics?start_time=1712880000&end_time=1715472000"
```

**Query Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `days` | `7` | Number of days to look back (1–90) |
| `region` | _(from `AWS_REGION` env)_ | AWS region to query CloudWatch in |
| `start_time` | _(auto)_ | Custom start time as Unix timestamp (overrides `days`) |
| `end_time` | _(now)_ | Custom end time as Unix timestamp |

**Response structure:**
```json
{
  "domain_name": "ses",
  "tenant_id": 0,
  "timestamp": "2025-05-12T11:30:00Z",
  "sends": 150000,
  "bounces": 450,
  "permanent_bounces": 300,
  "transient_bounces": 150,
  "complaints": 25,
  "rejects": 10,
  "bounce_rate": "0.3000%",
  "complaint_rate": "0.0167%",
  "error_rate": "0.3233%",
  "period_days": 7,
  "daily_volume": [
    {"date": "2025-05-06", "sends": 21000, "bounces": 60, "complaints": 3},
    {"date": "2025-05-07", "sends": 22000, "bounces": 65, "complaints": 4},
    {"date": "2025-05-08", "sends": 21500, "bounces": 70, "complaints": 5}
  ]
}
```

### Get Available SES Regions

```bash
curl "http://localhost:8081/api/ses-regions"
```

**Response:**
```json
{
  "regions": ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1", "ap-northeast-1", "sa-east-1"]
}
```

### Get Workflow Dashboard Data

```bash
# Get data for a specific tenant
curl "http://localhost:8081/api/workflows?tenant_id=1"

# With custom limit for recent failures
curl "http://localhost:8081/api/workflows?tenant_id=1&limit=100"

# With custom tasklist latency window (in seconds)
curl "http://localhost:8081/api/workflows?tenant_id=1&limit=50&tasklist_window=10800"

# All params together
curl "http://localhost:8081/api/workflows?tenant_id=1&limit=500&tasklist_window=86400"
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

### SES Delivery Dashboard
Monitors AWS SES email delivery health with metrics fetched from AWS CloudWatch:

- **Volume cards** — Total Sends, Bounces (with permanent/transient breakdown), Complaints, and Rejects over a configurable period (7/14/30/90 days)
- **Rate cards** — Bounce Rate, Complaint Rate, and combined Error Rate with color-coded thresholds (green ≤ 0.1%, yellow ≤ 0.5%, red > 0.5%)
- **Daily volume table** — Per-day breakdown of sends, bounces (with percentage), and complaints (with percentage)

The SES dashboard is available from the sidebar navigation and fetches data independently from the workflow metrics. Configure via `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `SES_CONFIG_SET_NAME` environment variables.

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
│   └── main.go                 # Single-file Go backend (~1900 lines)
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── App.css
        ├── pages/
        │   ├── DashboardPage.jsx
        │   ├── RecentFailuresPage.jsx
        │   ├── ActivityErrorsPage.jsx
        │   ├── P100LatencyPage.jsx
        │   └── SesDashboardPage.jsx
        └── components/
            ├── SummaryCards.jsx / .css
            ├── WorkflowTable.jsx / .css
            ├── RecentFailures.jsx / .css
            ├── TasklistLatency.jsx / .css
            ├── TenantSelector.jsx / .css
            └── SesMetrics.jsx / .css
```

### Building

```bash
# Backend
cd backend && go build -o slo-dashboard-backend .

# Frontend
cd frontend && npx vite build
```
