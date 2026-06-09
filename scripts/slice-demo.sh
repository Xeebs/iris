#!/usr/bin/env bash
# Vertical slice demo — single command, exit 0 = the slice chain works.
# Prereq: docker-compose -f infra/docker/docker-compose.yml up -d
set -euo pipefail

cd "$(dirname "$0")/.."

export DEMO_MODE=true
export EMBEDDING_PROVIDER=hash-deterministic

exec npx tsx scripts/slice-demo.ts
