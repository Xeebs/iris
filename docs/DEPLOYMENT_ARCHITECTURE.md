# Iris Deployment Architecture

## Overview

Iris is a three-tier application:

```
                        ┌─────────────────────────────────────┐
                        │          Load Balancer / CDN         │
                        │      (Traefik / AWS ALB / Nginx)     │
                        └────────┬─────────────┬──────────────┘
                                 │             │
               ┌─────────────────┘             └──────────────┐
               │                                               │
     ┌─────────▼─────────┐                         ┌──────────▼────────┐
     │   Iris Dashboard   │                         │    Iris API        │
     │  (Next.js / SSR)   │                         │  (Hono / Node.js)  │
     │    :3000           │                         │   :3001            │
     └────────────────────┘                         └──────┬─────────────┘
                                                           │
                        ┌──────────────────────────────────┤
                        │                                  │
              ┌─────────▼──────────┐          ┌───────────▼──────────┐
              │   Iris MCP Server   │          │   Data Stores         │
              │   (Node.js / SSE)   │          │                       │
              │   :3002             │          │  Postgres (pgvector)  │
              └─────────────────────┘          │  Redis                │
                        │                      │  Qdrant               │
                        │                      └───────────────────────┘
                  AI Clients
              (Claude, Cursor, etc.)
```

## Service Responsibilities

| Service | Port | Role |
|---------|------|------|
| `iris-api` | 3001 | REST API, webhook ingestion, connector sync, billing |
| `iris-mcp-server` | 3002 | MCP protocol server, context query, entity retrieval |
| `iris-dashboard` | 3000 | Next.js admin UI for workspace config and analytics |
| Postgres | 5432 | Primary database: entities, connectors, audit logs, vectors (pgvector) |
| Redis | 6379 | Session cache, rate limiting, queue state |
| Qdrant | 6333 | High-performance vector similarity search |
| Jaeger | 16686 | Distributed tracing (OTLP) |

## Data Flow

### Connector Sync
```
Connector API → iris-api (sync job) → SemanticIndexer → Postgres (entities)
                                                        → Qdrant (embeddings)
```

### MCP Context Query
```
AI Client → iris-mcp-server → Redis (semantic cache check)
                            → Postgres (entity retrieval)
                            → Qdrant (similarity search)
                            → ResponseBuilder → AI Client
```

### Webhook Ingestion
```
External Service → POST /api/v1/webhooks/:connector
                → iris-api (validates + transforms)
                → SemanticIndexer (incremental update)
```

## Deployment Topologies

### Small (1 API, single-node Postgres)
Best for: teams < 50 users, < 100K entities

```
Single VM or VPS:
  iris-api (1 replica)
  iris-mcp-server (1 replica)
  iris-dashboard (1 replica)
  Postgres 16 (local)
  Redis (local)
  Qdrant (local)
```

### Medium (3 API replicas, managed Postgres)
Best for: teams 50–500 users, < 1M entities

```
App servers (2-3 VMs):
  iris-api (3 replicas, round-robin LB)
  iris-mcp-server (2 replicas)
  iris-dashboard (1 replica, CDN for static assets)

Managed services:
  RDS Postgres 16 (db.r6g.large, Multi-AZ)
  ElastiCache Redis (cache.r6g.large)
  Qdrant (3-node cluster)
```

### High Availability (auto-scaling)
Best for: enterprise, > 1M entities

```
Kubernetes cluster:
  iris-api (HPA: 3–20 replicas)
  iris-mcp-server (HPA: 2–10 replicas)
  iris-dashboard (static export → CDN)

External managed:
  Aurora Postgres (Serverless v2)
  Redis Enterprise or Upstash
  Qdrant Cloud
  S3 for backups and exports
```

## Network Topology

In Kubernetes, services communicate within the cluster via ClusterIP services.
Only the dashboard and API are exposed externally via Ingress.
The MCP server can optionally be exposed externally (for Claude Desktop direct access).

```
External (Internet)
  → Ingress Controller (Nginx/Traefik)
    → iris-dashboard (ClusterIP:3000)
    → iris-api (ClusterIP:3001)        /api prefix
    → iris-mcp-server (ClusterIP:3002) /mcp prefix (optional)

Internal only:
  Postgres, Redis, Qdrant (no external exposure)
```

## Security Hardening

1. **Never expose Postgres, Redis, or Qdrant externally.** Use ClusterIP or private VPC subnets.
2. **Rotate secrets** — generate a strong `POSTGRES_PASSWORD` and `MCP_API_KEY_SALT`.
3. **TLS everywhere** — terminate at the load balancer; use internal TLS for Postgres in HA deployments.
4. **Pod security** — run containers as non-root; set `readOnlyRootFilesystem: true` for API pods.
5. **Network policies** — restrict pod-to-pod traffic: only `iris-api` pods may connect to Postgres.
6. **Audit logs** — all connector sync, entity access, and admin actions are logged to the `audit_log` table.
