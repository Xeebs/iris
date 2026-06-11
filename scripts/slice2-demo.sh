#!/usr/bin/env bash
# Slice 2 demo — real data source, real embeddings, measured accuracy.
# Single command; exit 0 = the full chain with real embeddings is proven.
# Prereqs: Postgres + Redis running; Ollama pulled with nomic-embed-text.
set -euo pipefail

cd "$(dirname "$0")/.."

# Locate pnpm — daemon-spawned shells may lack it in PATH; inject a shim via corepack.
if ! command -v pnpm &>/dev/null; then
  if command -v corepack &>/dev/null; then
    _PNPM_SHIM_DIR=$(mktemp -d)
    printf '#!/bin/bash\nexec corepack pnpm "$@"\n' > "$_PNPM_SHIM_DIR/pnpm"
    chmod +x "$_PNPM_SHIM_DIR/pnpm"
    export PATH="$_PNPM_SHIM_DIR:$PATH"
    trap 'rm -rf "$_PNPM_SHIM_DIR"' EXIT
  else
    echo "ERROR: pnpm not found. Install via: corepack enable pnpm" >&2
    exit 1
  fi
fi

# Refuse hash-deterministic — Slice 2 requires real semantic embeddings.
PROVIDER="${EMBEDDING_PROVIDER:-ollama}"
if [ "$PROVIDER" = "hash-deterministic" ]; then
  echo "ERROR: EMBEDDING_PROVIDER=hash-deterministic is forbidden for the Slice 2 demo." >&2
  echo "       Use EMBEDDING_PROVIDER=ollama (default) or EMBEDDING_PROVIDER=openai." >&2
  exit 1
fi
export EMBEDDING_PROVIDER="$PROVIDER"

# The demo runs apps via tsx (source), but their @iris/* workspace deps
# resolve through package "exports" to dist/, so those must be built first.
# Set SLICE_SKIP_BUILD=1 to skip when dist is known-current.
if [ "${SLICE_SKIP_BUILD:-0}" != "1" ]; then
  echo "Building slice packages (api, mcp-server + workspace deps)..."
  pnpm exec turbo run build --filter=@iris/api --filter=@iris/mcp-server
fi

exec node --import tsx scripts/slice2-demo.ts
