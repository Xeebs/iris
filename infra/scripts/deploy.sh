#!/usr/bin/env bash
# Iris deployment script — supports docker-compose and Helm (Kubernetes).
# Usage:
#   ./infra/scripts/deploy.sh docker          # Full docker-compose stack
#   ./infra/scripts/deploy.sh helm <ns>       # Helm deploy to Kubernetes namespace
#   ./infra/scripts/deploy.sh health-check    # Run health checks only
#   ./infra/scripts/deploy.sh migrate         # Run DB migrations only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker/docker-compose-full.yml"
HELM_DIR="${REPO_ROOT}/infra/helm"
ENV_FILE="${REPO_ROOT}/.env.local"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ─── Pre-flight checks ─────────────────────────────────────────────────────────

preflight_common() {
  info "Running pre-flight checks…"

  if [[ ! -f "${ENV_FILE}" ]]; then
    error ".env.local not found. Copy .env.example to .env.local and fill in secrets."
  fi

  # Ensure required env vars are set
  set -a; source "${ENV_FILE}"; set +a

  local required_vars=(OPENAI_API_KEY CLERK_SECRET_KEY CLERK_PUBLISHABLE_KEY)
  for var in "${required_vars[@]}"; do
    if [[ -z "${!var:-}" ]]; then
      error "Required env var ${var} is not set in .env.local"
    fi
  done

  info "Pre-flight checks passed."
}

# ─── Docker Compose deployment ─────────────────────────────────────────────────

deploy_docker() {
  preflight_common

  command -v docker >/dev/null 2>&1 || error "docker is not installed."
  docker compose version >/dev/null 2>&1 || error "docker compose plugin is not installed."

  info "Pulling latest images…"
  docker compose -f "${COMPOSE_FILE}" pull

  info "Starting infrastructure services…"
  docker compose -f "${COMPOSE_FILE}" up -d postgres redis qdrant

  info "Waiting for infrastructure to be healthy…"
  local retries=30
  while ! docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do
    retries=$((retries - 1))
    [[ $retries -eq 0 ]] && error "Postgres did not become healthy in time."
    sleep 2
  done
  info "Postgres is healthy."

  info "Running database migrations…"
  docker compose -f "${COMPOSE_FILE}" run --rm api node dist/migrate.js || warn "Migration step failed — check migration files."

  info "Starting all application services…"
  docker compose -f "${COMPOSE_FILE}" up -d

  health_check_docker
}

health_check_docker() {
  info "Running health checks…"
  local api_url="http://localhost:3001"
  local mcp_url="http://localhost:3002"
  local dash_url="http://localhost:3000"

  local retries=20
  while ! curl -sf "${api_url}/health" >/dev/null 2>&1; do
    retries=$((retries - 1))
    [[ $retries -eq 0 ]] && error "API health check failed. Check: docker compose logs api"
    sleep 3
  done
  info "API is healthy at ${api_url}"

  if curl -sf "${mcp_url}/health" >/dev/null 2>&1; then
    info "MCP server is healthy at ${mcp_url}"
  else
    warn "MCP server not yet healthy at ${mcp_url} — may still be starting."
  fi

  if curl -sf "${dash_url}" >/dev/null 2>&1; then
    info "Dashboard is accessible at ${dash_url}"
  else
    warn "Dashboard not yet accessible — may still be starting."
  fi

  info "Deployment complete."
  echo ""
  echo "  API:       ${api_url}"
  echo "  MCP:       ${mcp_url}"
  echo "  Dashboard: ${dash_url}"
  echo "  Jaeger:    http://localhost:16686"
}

# ─── Helm / Kubernetes deployment ─────────────────────────────────────────────

deploy_helm() {
  local namespace="${1:-iris}"
  preflight_common

  command -v helm >/dev/null 2>&1 || error "helm is not installed."
  command -v kubectl >/dev/null 2>&1 || error "kubectl is not installed."
  kubectl cluster-info >/dev/null 2>&1 || error "kubectl cannot reach cluster."

  info "Deploying Iris to Kubernetes namespace: ${namespace}"

  kubectl create namespace "${namespace}" --dry-run=client -o yaml | kubectl apply -f -

  # Create secrets from env file
  info "Syncing secrets to namespace ${namespace}…"
  kubectl create secret generic iris-api-secrets \
    --namespace="${namespace}" \
    --from-env-file="${ENV_FILE}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl create secret generic iris-mcp-secrets \
    --namespace="${namespace}" \
    --from-env-file="${ENV_FILE}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl create secret generic iris-dashboard-secrets \
    --namespace="${namespace}" \
    --from-env-file="${ENV_FILE}" \
    --dry-run=client -o yaml | kubectl apply -f -

  info "Installing/upgrading Helm charts…"
  helm upgrade --install iris-api "${HELM_DIR}/iris-api" \
    --namespace="${namespace}" \
    --wait --timeout=5m

  helm upgrade --install iris-mcp-server "${HELM_DIR}/iris-mcp-server" \
    --namespace="${namespace}" \
    --wait --timeout=5m

  helm upgrade --install iris-dashboard "${HELM_DIR}/iris-dashboard" \
    --namespace="${namespace}" \
    --wait --timeout=5m

  info "Helm deployment complete. Checking pod status…"
  kubectl get pods -n "${namespace}"
}

# ─── Migrations only ──────────────────────────────────────────────────────────

run_migrations() {
  preflight_common
  set -a; source "${ENV_FILE}"; set +a
  info "Running database migrations against DATABASE_URL…"
  cd "${REPO_ROOT}" && node apps/api/dist/migrate.js
  info "Migrations complete."
}

# ─── Dispatch ────────────────────────────────────────────────────────────────

case "${1:-help}" in
  docker)        deploy_docker ;;
  helm)          deploy_helm "${2:-iris}" ;;
  health-check)  health_check_docker ;;
  migrate)       run_migrations ;;
  *)
    echo "Usage: $0 {docker|helm [namespace]|health-check|migrate}"
    exit 1
    ;;
esac
