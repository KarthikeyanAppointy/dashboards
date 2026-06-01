# Background SLO Local Setup Runbook

This runbook is for someone who has no prior context on this codebase.

After following this document, you should be able to:
- start the local database
- connect the app to Elasticsearch and Cadence Web
- run the Go backend and React frontend locally
- sign in to the UI
- bootstrap the first admin user
- add or verify a tenant
- confirm the dashboard is working

## What This App Needs

The app has 4 main dependencies:

1. PostgreSQL
   Used by the backend to store tenants, RBAC, alerts, reports, and enriched workflow failure categories.

2. Elasticsearch
   Used as the live source for Cadence visibility data.

3. Cadence Web
   Used to fetch workflow history for failure reason/message enrichment and the workflow history modal.

4. Google OAuth client ID
   Used by the frontend login flow and backend token audience validation.

Optional:
- AWS credentials for the SES dashboard
- NotifyHub for notifications

## Ports Used Locally

| Component | Local Port | Notes |
|---|---:|---|
| Frontend (Vite) | `5173` | Open this in the browser |
| Backend (Go) | `8081` | Frontend proxies `/api` here |
| PostgreSQL | `5432` | Started via Docker Compose |
| Elasticsearch | `9000` | Use local ES or port-forward a cluster service here |
| Cadence Web | `8088` | Recommended local port for Cadence Web port-forward |

## Prerequisites

- Go `1.25+`
- Node.js `18+`
- npm
- Docker with Docker Compose
- `kubectl` if you are using shared cluster dependencies
- Access to:
  - a Cadence visibility Elasticsearch index
  - a Cadence Web instance
  - a Google OAuth client ID

## Choose Your Dependency Mode

You have 2 practical ways to run this app:

### Option A: Everything local except Cadence/ES are already local

Use this if you already have Elasticsearch and Cadence Web running on your machine or VPN.

### Option B: Run app locally, port-forward cluster dependencies

Use this if Elasticsearch and Cadence Web live inside Kubernetes.

This is the most common setup for this repo.

## Step 1: Install Frontend Dependencies

```bash
cd background-slo/frontend
npm ci
```

## Step 2: Start PostgreSQL

```bash
cd background-slo
docker compose up -d
```

Verify:

```bash
docker ps | rg slo-dashboard-db
```

Expected:
- container `slo-dashboard-db` is running

Database connection used by default:

```text
postgres://postgres:postgres@localhost:5432/slo_dashboard?sslmode=disable
```

If you want a clean local DB reset:

```bash
cd background-slo
docker compose down -v
docker compose up -d
```

## Step 3: Expose Elasticsearch and Cadence Web

### Option A: Already local

Make sure these URLs are reachable from your laptop:

- Elasticsearch: `http://localhost:9000`
- Cadence Web: `http://localhost:8088`

If your ports are different, use those values later in tenant config.

### Option B: Port-forward from Kubernetes

First, find the services:

```bash
kubectl get svc -A | rg 'elastic|cadence-web|cadence.*web'
```

You want:
- one Elasticsearch service
- one Cadence Web service

Examples only:
- `svc/cadence-1-1-0-elasticsearch-master-hl`
- `svc/cadence-web`

Open 2 separate terminals and run port-forwards.

#### Port-forward Elasticsearch

```bash
kubectl port-forward -n <namespace> svc/<elasticsearch-service> 9000:9200
```

If the service exposes a different target port, use that instead of `9200`.

Verify:

```bash
curl http://localhost:9000
```

You should get an Elasticsearch JSON response.

#### Port-forward Cadence Web

First inspect the service ports if needed:

```bash
kubectl get svc -n <namespace> <cadence-web-service> -o yaml
```

Then port-forward it. A common example is:

```bash
kubectl port-forward -n <namespace> svc/<cadence-web-service> 8088:8088
```

If the service uses another port, map local `8088` to that remote port instead.

Verify:

```bash
curl -I http://localhost:8088
```

If the root path is not useful, just make sure the TCP connection works.

## Step 4: Start the Backend

Open a new terminal:

```bash
cd background-slo/backend
```

Run it with app-wide local dev config:

```bash
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/slo_dashboard?sslmode=disable"
export PORT="8081"
export GOOGLE_CLIENT_ID="<your-google-client-id>.apps.googleusercontent.com"
export APPONTY_ONLY_LOGIN="false"
export ADMIN_KEY="local-admin-key"

go run main.go
```

Important notes:

- `PORT` should be `8081` for local dev. The Vite frontend proxies `/api` to `http://localhost:8081`.
- You do not need `DEFAULT_TENANT_NAME`, `DEFAULT_DOMAIN_ID`, `DEFAULT_DOMAIN_NAME`, `DEFAULT_ES`, `DEFAULT_INDEX`, or `DEFAULT_CADENCE_WEB_URL` to start `main.go` for normal local development.
- `APPONTY_ONLY_LOGIN=false` is useful for local testing if you are not signing in with an `@appointy.com` account.
- `ADMIN_KEY` is only for first-time admin bootstrap.
- Tenant-specific settings such as domain, ES endpoint, ES index, audience URL, NotifyHub values, and Cadence Web URL should be created from the **Clients** page after login.

Expected backend log highlights:

- database connected
- tables ensured / migrated automatically
- backend listening on `:8081`

Health check:

```bash
curl http://localhost:8081/health
```

Expected:

```json
{"status":"ok"}
```

## Step 5: Start the Frontend

Open another terminal:

```bash
cd background-slo/frontend
```

Run:

```bash
export VITE_GOOGLE_CLIENT_ID="<your-google-client-id>.apps.googleusercontent.com"
export VITE_APPONTY_ONLY_LOGIN="false"

npm run dev
```

Open:

```text
http://localhost:5173
```

Important:

- `VITE_GOOGLE_CLIENT_ID` must match the backend `GOOGLE_CLIENT_ID`.
- If they do not match, login will fail with a token audience mismatch.

## Step 6: Sign In

Open the app in the browser and sign in with Google.

If login fails, check:
- `VITE_GOOGLE_CLIENT_ID`
- backend `GOOGLE_CLIENT_ID`
- `APPONTY_ONLY_LOGIN` / `VITE_APPONTY_ONLY_LOGIN`

## Step 7: Bootstrap the First Admin

This app uses RBAC. On a fresh DB, you must create the first admin user once.

After you sign in once, run:

```bash
curl -X POST http://localhost:8081/api/rbac/setup-admin \
  -H "Content-Type: application/json" \
  -d '{
    "admin_key": "local-admin-key",
    "user_email": "<your-google-login-email>"
  }'
```

Expected:

```json
{
  "status": "admin_created",
  "user_email": "<your-google-login-email>",
  "role": "admin"
}
```

Important:

- The user must have signed in at least once before this call.
- The `admin_key` must match the backend `ADMIN_KEY`.

After this, refresh the frontend.

## Step 8: Create the Client Configuration

Use the UI:

- open `Clients`
- add or edit a tenant

Required fields:
- `name`
- `domain_id`
- `domain_name`

Recommended fields:
- `es_endpoint`
- `es_index`
- `cadence_web_url`

For local + port-forward setup, a good example is:

```text
name: local-dev
domain_id: <cadence-domain-uuid>
domain_name: <cadence-domain-name>
es_endpoint: http://localhost:9000
es_index: cadence-visibility
cadence_web_url: http://localhost:8088
```

Notes:

- By default, the UI uses `http://localhost:9000` for `es_endpoint`.
- This is the recommended place to configure tenant-specific values instead of using backend `DEFAULT_*` environment variables.

You can also create a tenant via API:

```bash
curl -X POST http://localhost:8081/api/tenants \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "local-dev",
    "domain_id": "<cadence-domain-uuid>",
    "domain_name": "<cadence-domain-name>",
    "es_endpoint": "http://localhost:9000",
    "es_index": "cadence-visibility",
    "cadence_web_url": "http://localhost:8088"
  }'
```

If you are using the UI, this manual API call is not required.

## Step 9: Smoke Test the Main API

Check tenants:

```bash
curl -H "Authorization: Bearer <session-token>" \
  http://localhost:8081/api/tenants
```

Check workflows:

```bash
curl -H "Authorization: Bearer <session-token>" \
  "http://localhost:8081/api/workflows?tenant_id=1"
```

Expected:
- `total_failed` should be non-zero if your domain has failures
- `recent_failed` should list recent failed/timed-out workflows
- `activity_errors` may take a little time to populate because failure categories are enriched asynchronously from Cadence history

## Step 10: What “Working” Looks Like

When everything is wired correctly:

- the frontend opens at `http://localhost:5173`
- you can sign in successfully
- tenant dropdown shows at least one tenant
- overview page shows workflow numbers
- failures page shows recent failed/timed-out workflows
- activity errors page shows:
  - live failure count from ES immediately
  - categorized error rows from Postgres once enrichment catches up
  - a small message like `Latest failure errors exist and will be added...` when new failures were seen in ES but not enriched yet
- clicking workflow history from Recent Failures works if `cadence_web_url` is set correctly

## Full Local Dev Command Summary

Use 5 terminals if you are port-forwarding both Elasticsearch and Cadence Web.

### Terminal 1: PostgreSQL

```bash
cd background-slo
docker compose up -d
```

### Terminal 2: Elasticsearch port-forward

```bash
kubectl port-forward -n <namespace> svc/<elasticsearch-service> 9000:9200
```

### Terminal 3: Cadence Web port-forward

```bash
kubectl port-forward -n <namespace> svc/<cadence-web-service> 8088:<cadence-web-port>
```

### Terminal 4: Backend

```bash
cd background-slo/backend

export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/slo_dashboard?sslmode=disable"
export PORT="8081"
export GOOGLE_CLIENT_ID="<your-google-client-id>.apps.googleusercontent.com"
export APPONTY_ONLY_LOGIN="false"
export ADMIN_KEY="local-admin-key"

go run main.go
```

### Terminal 5: Frontend

```bash
cd background-slo/frontend

export VITE_GOOGLE_CLIENT_ID="<your-google-client-id>.apps.googleusercontent.com"
export VITE_APPONTY_ONLY_LOGIN="false"

npm run dev
```

Then open `http://localhost:5173`.

## Troubleshooting

### Backend health check fails

Check:
- Postgres is running on `5432`
- `DATABASE_URL` is correct
- backend logs for migration or DB connection errors

### Frontend opens but login says `VITE_GOOGLE_CLIENT_ID is not set`

You started the frontend without:

```bash
VITE_GOOGLE_CLIENT_ID="..."
```

Restart `npm run dev` with that env var.

### Login fails with token audience mismatch

Your frontend and backend client IDs do not match.

Make these the same:

- `VITE_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`

### Login says access restricted to `@appointy.com`

For local testing, use:

```bash
APPONTY_ONLY_LOGIN="false"
VITE_APPONTY_ONLY_LOGIN="false"
```

Note:
- the env var is intentionally spelled `APPONTY`, matching the codebase

### You see no workflow data

Usually one of these is wrong:

- `domain_id`
- `es_endpoint`
- `es_index`
- Elasticsearch port-forward is down

Check:

```bash
curl http://localhost:9000
```

### Recent failures show, but Activity Errors stays empty

Check:

- `cadence_web_url` is configured on the tenant
- Cadence Web port-forward is up
- backend can reach the Cadence Web URL

Recommended local value:

```text
http://localhost:8088
```

### Client config is not showing what you expected

For normal local development, client settings should be created or edited from the **Clients** page.

If you want a truly fresh start:

```bash
cd background-slo
docker compose down -v
docker compose up -d
```

Then:

- start backend again
- sign in
- bootstrap the first admin
- recreate the client from the UI

## Related Files

- Main README: [README.md](../README.md)
- Workflow history notes: [workflow-history-gcs.md](workflow-history-gcs.md)
