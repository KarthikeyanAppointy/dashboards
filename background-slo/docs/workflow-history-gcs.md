# Workflow history uploads to GCS

When a Codefac pipeline or alert template uses `{{workflow_history}}` or `{{history}}`, the backend fetches Cadence workflow history and uploads it to Google Cloud Storage. The placeholder is replaced with a **GCS URL** in the payload sent to NotifyHub/Codefac.

## Prerequisites

1. **GCS bucket** (e.g. `slo-dashboard`).
2. **GCP service account** with permission to create objects in that bucket, for example:
   - `roles/storage.objectCreator` on the bucket, or
   - `roles/storage.objectAdmin` if you need broader access.
3. **Tenant `cadence_web_url`** configured in the dashboard so history can be fetched from Cadence Web.

Example service account:

```text
math-phase2-bucket-sa@mathnasium-352013.iam.gserviceaccount.com
```

### Create a JSON key (for local dev or Kubernetes secret)

In GCP Console: **IAM & Admin → Service Accounts →** your SA → **Keys → Add key → JSON**.

Save the file outside git, e.g. `~/keys/math-phase2-bucket-sa.json`. **Never commit this file.**

---

## Configuration reference

| Variable | Where | Purpose |
|----------|--------|---------|
| `WORKFLOW_HISTORY_STORAGE` | ConfigMap / env | `auto`, `gcs`, or `inline` |
| `GCS_HISTORY_BUCKET` | ConfigMap / env | Bucket name |
| `GCS_HISTORY_PREFIX` | ConfigMap / env | Object prefix (default `workflow-history`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Env | Path to JSON key file |
| `GCS_SERVICE_ACCOUNT_KEY_FILE` | Env | Same as above (alias) |
| `GCS_SERVICE_ACCOUNT_EMAIL` | Env | Impersonate SA via `gcloud` (local only) |
| `GCS_ACCESS_TOKEN` | Secret / env | Short-lived token override (optional) |

**Helm values** (preferred):

```yaml
workflowHistory:
  storage: gcs          # auto | gcs | inline
  bucket: "slo-dashboard"
  prefix: "qa-mathnasium"
  gcsCredentials:
    existingSecret: ""  # see below
    secretKey: "gcs-service-account.json"
    mountPath: "/var/secrets/gcs"
```

Object path pattern:

```text
{prefix}/{domain}/{YYYY/MM/DD}/{workflowId}_{runId}_history.json
```

---

## Authentication methods

The backend resolves a GCP access token in this order:

1. `GCS_ACCESS_TOKEN` (if set)
2. JSON key file (`GCS_SERVICE_ACCOUNT_KEY_FILE` or `GOOGLE_APPLICATION_CREDENTIALS`)
3. `GCS_SERVICE_ACCOUNT_EMAIL` (gcloud impersonation)
4. GCE/GKE metadata server (Workload Identity on cluster)
5. `gcloud auth print-access-token` (local fallback)

| Environment | Recommended approach |
|-------------|----------------------|
| **Local `go run`** | JSON key via `GOOGLE_APPLICATION_CREDENTIALS` |
| **GKE (production)** | Workload Identity **or** mounted JSON secret |
| **Quick local test** | `GCS_ACCESS_TOKEN="$(gcloud auth print-access-token)"` |

---

## Local development

From `background-slo/backend`:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/keys/math-phase2-bucket-sa.json"

WORKFLOW_HISTORY_STORAGE="gcs" \
GCS_HISTORY_BUCKET="slo-dashboard" \
GCS_HISTORY_PREFIX="background" \
DEFAULT_TENANT_NAME="qa-mathnasium" \
DEFAULT_DOMAIN_ID="your-domain-id" \
DEFAULT_DOMAIN_NAME="qa-mathnasium" \
DEFAULT_ES="http://localhost:9000" \
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
ADMIN_KEY="admin@123" \
APPONTY_ONLY_LOGIN="false" \
go run main.go
```

**Shell tip:** Put each `VAR=value` on its own line, or ensure a space before `\` at end of line. A missing newline can glue the next variable onto the previous value (e.g. `...comADMIN_KEY=...`).

### Alternative: impersonate a service account (no JSON key)

Your user needs `roles/iam.serviceAccountTokenCreator` on the target SA:

```bash
GCS_SERVICE_ACCOUNT_EMAIL="math-phase2-bucket-sa@mathnasium-352013.iam.gserviceaccount.com" \
WORKFLOW_HISTORY_STORAGE="gcs" \
GCS_HISTORY_BUCKET="slo-dashboard" \
# ... other env vars ...
go run main.go
```

Requires `gcloud` installed and `gcloud auth login`.

---

## Kubernetes / Helm

Deploy from the repo root (adjust release name and namespace):

```bash
helm upgrade --install slo-dashboard ./background-slo/charts/slo-dashboard \
  -f ./background-slo/charts/slo-dashboard/values.local.yaml \
  --namespace slo \
  --create-namespace
```

Set bucket settings in `values.local.yaml`:

```yaml
workflowHistory:
  storage: gcs
  bucket: "slo-dashboard"
  prefix: "qa-mathnasium"
```

### Option A — Existing Kubernetes secret (recommended)

Create the secret manually (JSON never goes into git or Helm values):

```bash
kubectl create secret generic slo-dashboard-gcs-sa \
  --namespace slo \
  --from-file=gcs-service-account.json="$HOME/keys/math-phase2-bucket-sa.json"
```

Point the chart at it in `values.local.yaml`:

```yaml
workflowHistory:
  storage: gcs
  bucket: "slo-dashboard"
  prefix: "qa-mathnasium"
  gcsCredentials:
    existingSecret: "slo-dashboard-gcs-sa"
    secretKey: "gcs-service-account.json"
    mountPath: "/var/secrets/gcs"
```

Upgrade the release:

```bash
helm upgrade --install slo-dashboard ./background-slo/charts/slo-dashboard \
  -f ./background-slo/charts/slo-dashboard/values.local.yaml \
  --namespace slo
```

The backend pod receives:

- Volume: secret mounted at `/var/secrets/gcs/key.json`
- `GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcs/key.json`

### Option B — Pass JSON at deploy time (`--set-file`)

Do not store the key in `values.local.yaml`. Pass it only on install/upgrade:

```bash
helm upgrade --install slo-dashboard ./background-slo/charts/slo-dashboard \
  -f ./background-slo/charts/slo-dashboard/values.local.yaml \
  --namespace slo \
  --set-file secret.gcsServiceAccountJson="$HOME/keys/math-phase2-bucket-sa.json"
```

Helm stores the key in the release secret as `gcs-service-account.json` and mounts it the same way as Option A.

**Do not use Option A and Option B together** for the same key; if `existingSecret` is set, the chart does not add a duplicate key from `secret.gcsServiceAccountJson`.

### Option C — Workload Identity (no JSON key in cluster)

Preferred on GKE when you can avoid long-lived keys.

1. Grant the GCP SA access to the bucket (`roles/storage.objectCreator`).
2. Bind Kubernetes SA → GCP SA (Workload Identity).
3. In `values.local.yaml`:

```yaml
workflowHistory:
  storage: gcs
  bucket: "slo-dashboard"
  prefix: "qa-mathnasium"
  # Leave gcsCredentials.existingSecret empty

serviceAccount:
  create: true
  name: "slo"
  workloadIdentity:
    enabled: true
    gcpServiceAccount: "math-phase2-bucket-sa@mathnasium-352013.iam.gserviceaccount.com"
```

4. Do **not** set `secret.gcsServiceAccountJson` or `GCS_ACCESS_TOKEN`.

The pod uses the GKE metadata server; no `GOOGLE_APPLICATION_CREDENTIALS` mount is required.

---

## Codefac / alert templates

Use placeholders in the pipeline payload template:

```json
{
  "workflow_id": "{{workflow_id}}",
  "workflow_history": "{{workflow_history}}"
}
```

After substitution, `workflow_history` becomes a URL like:

```text
https://storage.googleapis.com/slo-dashboard/qa-mathnasium/2026/05/22/workflow-id_run-id_history.json
```

Ensure Codefac (or downstream consumers) can **read** that URL if the bucket is private (signed URLs are not generated today).

---

## Verify

1. **Backend logs** on startup:
   - `Workflow history: GCS upload (bucket=..., prefix=...)`
2. **Trigger** a failed/timed-out workflow with a Codefac `workflow_failure` pipeline that includes `{{workflow_history}}`.
3. **Check the bucket** for a new object under `{prefix}/{domain}/{date}/`.
4. **GCS auth errors** in logs: `upload history to GCS` or `get GCP token` — fix IAM or credentials.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `GCS_HISTORY_BUCKET not set` | Bucket env missing | Set `workflowHistory.bucket` in Helm or `GCS_HISTORY_BUCKET` locally |
| `no GCP access token available` | No credentials on pod | Mount JSON secret, enable Workload Identity, or set `GCS_ACCESS_TOKEN` |
| `GCS upload: HTTP 403` | SA lacks bucket permission | Grant `storage.objectCreator` on the bucket |
| `(cadence_web_url not configured)` | Tenant missing Cadence URL | Set `cadence_web_url` on the tenant |
| `(history fetch failed: ...)` | Cadence Web unreachable | Check URL, network, workflow id/run id |
| `token audience mismatch` | Wrong `GOOGLE_CLIENT_ID` or shell typo | Match frontend `VITE_GOOGLE_CLIENT_ID`; fix line continuations in shell |

---

## Security notes

- Rotate JSON keys periodically; prefer Workload Identity on GKE.
- Do not commit `values.local.yaml` with secrets, AWS keys, or JSON keys.
- Restrict bucket access to the service account and consumers that need read access.
- `GCS_ACCESS_TOKEN` expires quickly; use only for debugging if JSON/WI is unavailable.
