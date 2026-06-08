# Self-Hosted Iris Deployment Guide

This guide covers deploying Iris on your own infrastructure using Docker Compose (single-node) or Kubernetes via Helm.

---

## System Requirements

### Small Deployment (1 API replica, shared Redis)
| Component | CPU | RAM | Disk |
|-----------|-----|-----|------|
| API server | 1 vCPU | 1 GB | 10 GB |
| MCP server | 0.5 vCPU | 512 MB | 2 GB |
| Dashboard | 0.5 vCPU | 512 MB | 2 GB |
| Postgres + pgvector | 2 vCPU | 4 GB | 50 GB SSD |
| Redis | 0.5 vCPU | 512 MB | 5 GB |
| Qdrant | 1 vCPU | 2 GB | 20 GB |

**Total: ~6 vCPU / 9 GB RAM / 89 GB disk**

### Medium Deployment (3 API replicas, separate worker)
Scale the API to 3 replicas and add a dedicated Postgres replica.  
**Total: ~12 vCPU / 20 GB RAM / 200 GB disk**

### High-Availability Deployment
- API/MCP/Worker auto-scaling (HPA in Kubernetes)
- External managed Postgres (RDS, Cloud SQL)
- External Redis cluster (ElastiCache, Memorystore)
- Qdrant cluster with replication
- Object storage (S3/GCS) for backups

---

## Quick Start (Docker Compose)

### 1. Clone and configure

```bash
git clone https://github.com/xeebs/iris.git
cd iris
cp .env.example .env.local
```

Edit `.env.local` and fill in:
- `OPENAI_API_KEY` — required for embeddings
- `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` — authentication
- `POSTGRES_PASSWORD` — database password (change from default)
- `STRIPE_SECRET_KEY` — billing (optional for self-hosted)

**Never commit `.env.local` to version control.**

### 2. Start infrastructure services

```bash
# Start Postgres, Redis, Qdrant (infrastructure only)
docker compose -f infra/docker/docker-compose.yml up -d

# Run database migrations
pnpm db:migrate
```

### 3. Deploy the full stack

```bash
# Deploy everything with pre-flight checks
./infra/scripts/deploy.sh docker
```

The script will:
1. Pull latest images
2. Start infrastructure (Postgres, Redis, Qdrant, Jaeger)
3. Run DB migrations
4. Start API, MCP server, dashboard
5. Run health checks and print service URLs

### 4. Verify deployment

```bash
# Check all services are healthy
./infra/scripts/deploy.sh health-check

# View logs
docker compose -f infra/docker/docker-compose-full.yml logs -f api
```

---

## Initial Admin Setup

### Create first workspace

1. Open the dashboard at `http://localhost:3000`
2. Sign up with Clerk authentication
3. Navigate to **Settings → Workspaces → New Workspace**
4. Enter a name and select your plan

### Configure connectors

1. Go to **Connectors → Add Connector**
2. Select your data source (HubSpot, Salesforce, Google Drive, etc.)
3. Complete OAuth or enter API credentials
4. Run an initial sync: click **Sync Now**

### Set up billing (optional for self-hosted)

If you have Stripe credentials:
1. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to `.env.local`
2. Configure products in the Stripe dashboard
3. Set plan limits in Settings → Billing

---

## Kubernetes (Helm)

### Prerequisites

- Kubernetes 1.28+
- Helm 3.12+
- `kubectl` configured with cluster access

### Deploy

```bash
# Deploy to 'iris' namespace
./infra/scripts/deploy.sh helm iris

# Or manually with Helm
helm upgrade --install iris-api infra/helm/iris-api \
  --namespace iris \
  --set image.tag=v1.0.0 \
  --wait

helm upgrade --install iris-mcp-server infra/helm/iris-mcp-server \
  --namespace iris --wait

helm upgrade --install iris-dashboard infra/helm/iris-dashboard \
  --namespace iris --wait
```

### Secrets

Create a Kubernetes secret before deploying:

```bash
kubectl create secret generic iris-api-secrets \
  --namespace iris \
  --from-env-file=.env.local
```

### Scaling

```bash
# Scale API to 5 replicas
kubectl scale deployment iris-api --replicas=5 -n iris

# Enable HPA
helm upgrade iris-api infra/helm/iris-api \
  --set autoscaling.enabled=true \
  --set autoscaling.minReplicas=3 \
  --set autoscaling.maxReplicas=10 -n iris
```

---

## Monitoring

### Prometheus scraping

API pods expose metrics at `/metrics`. Add to your Prometheus config:

```yaml
scrape_configs:
  - job_name: iris-api
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: "true"
```

### Distributed tracing (Jaeger)

The Jaeger UI is available at `http://localhost:16686` in Docker Compose.  
For production, configure `OTEL_EXPORTER_OTLP_ENDPOINT` to point to your Jaeger or OTLP-compatible collector.

### Log aggregation

Iris uses structured JSON logs (pino). Ingest with Fluentd, Promtail, or Vector into your preferred log backend.

---

## SSL / TLS Configuration

### Docker Compose with Traefik

Enable the reverse proxy profile:

```bash
ACME_EMAIL=admin@yourdomain.com \
API_HOST=api.yourdomain.com \
docker compose -f infra/docker/docker-compose-full.yml \
  --profile with-proxy up -d
```

Traefik will automatically obtain Let's Encrypt certificates.

### Kubernetes with cert-manager

```bash
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true

# Create a ClusterIssuer for Let's Encrypt
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

Then enable Ingress in `values.yaml` with `tls` configured.

---

## Database Backup Strategy

### Docker Compose

```bash
# Daily backup
docker compose exec postgres pg_dump -U postgres iris | gzip > iris_$(date +%Y%m%d).sql.gz

# Restore
gunzip -c iris_20260101.sql.gz | docker compose exec -T postgres psql -U postgres iris
```

### Automated backup with cron

```cron
0 2 * * * /path/to/iris/infra/scripts/backup.sh >> /var/log/iris-backup.log 2>&1
```

---

## Upgrade Procedure

1. **Test on staging first.** Never upgrade production directly.
2. Create a database backup.
3. Pull new images: `docker compose pull` or update Helm image tags.
4. Run migrations: `./infra/scripts/deploy.sh migrate`
5. Rolling restart: `docker compose up -d` (Docker) or `helm upgrade` (Kubernetes).
6. Run health checks: `./infra/scripts/deploy.sh health-check`

---

## Migration: Cloud to Self-Hosted

If you were previously using the Iris cloud service:

1. Export your workspace data: **Settings → Export → Download workspace archive**
2. Set up a fresh self-hosted installation (this guide)
3. Import: `POST /api/v1/data/import` with the archive file
4. Update your Claude Desktop / Cursor config to point to the new MCP server URL
5. Verify connector sync and validate entity counts match

See `docs/TROUBLESHOOTING.md` for common issues during migration.
