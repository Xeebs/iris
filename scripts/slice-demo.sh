#!/usr/bin/env bash
# Vertical slice demo — single command, exit 0 = the slice chain works.
# Prereq: docker-compose -f infra/docker/docker-compose.yml up -d
set -euo pipefail

cd "$(dirname "$0")/.."

export DEMO_MODE=true
export EMBEDDING_PROVIDER=hash-deterministic

# The demo runs apps via tsx (source), but their @iris/* workspace deps resolve
# through package "exports" to dist/, so those must be built first. Build here
# so this stays a true single command from a fresh checkout (acceptance
# criterion #1: no manual steps). Turbo caches, so repeat runs are instant.
# Set SLICE_SKIP_BUILD=1 to skip when you know dist is current.
if [ "${SLICE_SKIP_BUILD:-0}" != "1" ]; then
  echo "Building slice packages (api, mcp-server + workspace deps)..."
  pnpm exec turbo run build --filter=@iris/api --filter=@iris/mcp-server
fi

# node --import tsx, not npx tsx — keeps the demo a single process so signals
# sent by the CI runner (step timeout / cancellation) reach it directly.
exec node --import tsx scripts/slice-demo.ts
