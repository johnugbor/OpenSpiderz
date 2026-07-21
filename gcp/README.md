# Google Cloud deployment

This directory deploys Spiderz to project `spiderz-502913` in `us-central1`.

## Target architecture

```text
Browser
  └─ Cloud Run: spiderz-web
       └─ Cloud Run: spiderz-api ── Cloud SQL for PostgreSQL
                                  └─ Memorystore for Redis
                                       └─ GKE Autopilot: spiderz-worker
All runtime services ──────────────── Cloud Storage (binary files)
Secrets ───────────────────────────── Secret Manager
```

The API is public. The GKE worker has no public Service; it continuously reads BullMQ jobs from Memorystore. Keep API, Cloud SQL, Memorystore, GKE, and storage in `us-central1`.

## One-time prerequisites

Run from Cloud Shell or a local shell authenticated with `gcloud`:

```bash
gcloud config set project spiderz-502913
gcloud config set run/region us-central1
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com 
gcloud services enable sqladmin.googleapis.com redis.googleapis.com container.googleapis.com secretmanager.googleapis.com 
gcloud services enable storage.googleapis.com servicenetworking.googleapis.com

gcloud artifacts repositories create spiderz --repository-format=docker --location=us-central1
gcloud storage buckets create gs://spiderz-502913-binary --location=us-central1 --uniform-bucket-level-access
```

Create Cloud SQL PostgreSQL, Memorystore Redis, and a GKE Autopilot cluster in the same region. Use private networking for Redis. Cloud Run reaches Memorystore through Direct VPC egress.

```bash
gcloud container clusters create-auto spiderz-workers --region=us-central1
```

Create a database user and the `spiderz` database, then apply every SQL file from `packages/server/sql` in numeric order. Use Cloud SQL Auth Proxy or a private network connection; do not expose the database publicly merely to run migrations.

## Build images

```bash
export PROJECT_ID=spiderz-502913
export REGION=us-central1
export REPOSITORY=$REGION-docker.pkg.dev/$PROJECT_ID/spiderz

export TAG=$(git rev-parse --short HEAD)
gcloud builds submit --config gcp/cloudbuild.yaml --substitutions=_TARGET=api,_IMAGE=$REPOSITORY/spiderz-api:$TAG
gcloud builds submit --config gcp/cloudbuild.yaml --substitutions=_TARGET=worker,_IMAGE=$REPOSITORY/spiderz-worker:$TAG
```

## Secrets and runtime configuration

Copy `runtime.env.example` outside the repository and fill it in. Store each sensitive value in Secret Manager. Do not upload the file itself to source control or Artifact Registry.

The current binary driver uses an S3-compatible client. Cloud Storage can support this through its XML/S3 interoperability layer and HMAC credentials. A future native Cloud Storage driver can remove the HMAC compatibility credentials.

For GKE, create a Kubernetes secret from your protected runtime file. In this file, set `DATABASE_URL` to `postgresql://spiderz:URL_ENCODED_PASSWORD@127.0.0.1:5432/spiderz`; the Cloud SQL Auth Proxy sidecar in `worker-deployment.yaml` provides this local endpoint.

```bash
kubectl create namespace spiderz
kubectl -n spiderz create secret generic spiderz-runtime --from-env-file=/secure/path/spiderz-runtime.env
kubectl -n spiderz create serviceaccount spiderz-worker
```

Grant the Kubernetes service account permission to connect through the Cloud SQL Auth Proxy using Workload Identity:

```bash
gcloud iam service-accounts create spiderz-worker --display-name="Spiderz GKE worker"
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:spiderz-worker@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
gcloud iam service-accounts add-iam-policy-binding spiderz-worker@PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:PROJECT_ID.svc.id.goog[spiderz/spiderz-worker]" \
  --role="roles/iam.workloadIdentityUser"
kubectl -n spiderz annotate serviceaccount spiderz-worker \
  iam.gke.io/gcp-service-account=spiderz-worker@PROJECT_ID.iam.gserviceaccount.com
```

For Cloud Run, map each secret to the matching environment variable using Secret Manager. Keep non-secret values such as `PORT`, `HOST`, and `BINARY_STORAGE_DRIVER` as regular environment variables.

From Windows PowerShell, `publish-api-secrets.ps1` uploads the selected sensitive values in `runtime.api.env` and writes the resulting Cloud Run bindings to `api-secret-bindings.txt` without printing secret values:

```powershell
.\gcp\publish-api-secrets.ps1
```

## Deploy order

1. Deploy `spiderz-api` to Cloud Run with Cloud SQL attached, Direct VPC egress enabled, and the API runtime secrets mapped. Record its HTTPS URL.
2. Build the web image with the API URL baked in, then deploy it to Cloud Run.

   ```bash
   export API_URL=https://YOUR_API_URL
   gcloud builds submit --config gcp/cloudbuild.yaml \
     --substitutions=_TARGET=web,_IMAGE=$REPOSITORY/spiderz-web:$TAG,_VITE_API_BASE_URL=$API_URL
   ```

3. Set `CORS_ORIGIN` to the final web URL or custom domain, then deploy a new API revision.
4. Update Google/Slack/Notion/Airtable/Microsoft OAuth redirect URIs to the final API host.
5. Deploy the worker manifest after replacing `IMAGE_URL`.

```bash
kubectl config set-context --current --namespace=spiderz
sed "s|IMAGE_URL|$REPOSITORY/spiderz-worker:YOUR_TAG|" worker-deployment.yaml | kubectl apply -f -
kubectl rollout status deployment/spiderz-worker
```

## Production checklist

- Use a custom domain and HTTPS for the web and API services.
- Use Secret Manager and IAM least privilege; rotate OAuth/HMAC keys.
- Keep Cloud SQL automated backups and point-in-time recovery enabled.
- Enable Redis AUTH and transit encryption where supported by the selected Memorystore tier.
- Set Cloud Run API minimum instances and concurrency after load testing.
- Add Cloud Monitoring alerting for Cloud Run errors, GKE worker restarts, Redis memory, queue latency, Cloud SQL connections, and failed executions.
- Restrict ingress, CORS, service accounts, and Cloud Storage bucket IAM.
