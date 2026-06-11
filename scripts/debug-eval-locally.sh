#!/usr/bin/env bash
# debug-eval-locally.sh — run the Slice 2 eval harness against a locally running Iris instance.
#
# Unlike slice2-demo.sh, this script does NOT reset the database or start any services.
# It assumes the following are already running:
#   - Iris API (default port 3902, or set PORT env var)
#   - Iris MCP server (spawned by eval-retrieval.ts as a child over stdio)
#   - Ollama (if EMBEDDING_PROVIDER=ollama, default)
#   - A seeded iris_demo_source database
#
# Usage:
#   IRIS_API_KEY=iris_xxx SLICE_WORKSPACE_ID=ws_xxx bash scripts/debug-eval-locally.sh
#   IRIS_API_KEY=iris_xxx SLICE_WORKSPACE_ID=ws_xxx bash scripts/debug-eval-locally.sh --verbose
#
# --verbose: print the full MCP response for every question (not just failures).
#
# To obtain IRIS_API_KEY and SLICE_WORKSPACE_ID, run the demo bootstrap once:
#   curl -X POST http://localhost:3902/api/v1/demo/bootstrap \
#        -H 'Content-Type: application/json' \
#        -d '{"name":"Debug Workspace"}'
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
: "${EMBEDDING_PROVIDER:=ollama}"
: "${DATABASE_URL:=postgres://postgres:postgres@localhost:5432/iris}"
: "${REDIS_URL:=redis://localhost:6379}"
: "${DEMO_SOURCE_DATABASE_URL:=postgres://postgres:postgres@localhost:5432/iris_demo_source}"

if [[ -z "${IRIS_API_KEY:-}" ]]; then
  echo "ERROR: IRIS_API_KEY is required. Run demo bootstrap to obtain one:" >&2
  echo "  curl -X POST http://localhost:3902/api/v1/demo/bootstrap \\" >&2
  echo "       -H 'Content-Type: application/json' \\" >&2
  echo "       -d '{\"name\":\"Debug Workspace\"}'" >&2
  exit 1
fi

if [[ -z "${SLICE_WORKSPACE_ID:-}" ]]; then
  echo "ERROR: SLICE_WORKSPACE_ID is required (returned by demo bootstrap)." >&2
  exit 1
fi

if [[ "${EMBEDDING_PROVIDER}" == "hash-deterministic" ]]; then
  echo "ERROR: EMBEDDING_PROVIDER=hash-deterministic is forbidden for eval." >&2
  echo "       Use EMBEDDING_PROVIDER=ollama (default) or EMBEDDING_PROVIDER=openai." >&2
  exit 1
fi

echo "=== Iris Eval Harness (debug mode) ==="
echo "  Workspace:          ${SLICE_WORKSPACE_ID}"
echo "  Embedding provider: ${EMBEDDING_PROVIDER}"
echo "  Database:           ${DATABASE_URL}"
echo "  Demo source DB:     ${DEMO_SOURCE_DATABASE_URL}"
echo ""

export EMBEDDING_PROVIDER DATABASE_URL REDIS_URL DEMO_SOURCE_DATABASE_URL \
       IRIS_API_KEY SLICE_WORKSPACE_ID

# Pass --verbose through to the eval script if given.
VERBOSE_FLAG=""
for arg in "$@"; do
  if [[ "$arg" == "--verbose" ]]; then
    VERBOSE_FLAG="--verbose"
    break
  fi
done

cd "${ROOT}/apps/mcp-server"
exec node --import tsx src/eval-retrieval.ts ${VERBOSE_FLAG}
