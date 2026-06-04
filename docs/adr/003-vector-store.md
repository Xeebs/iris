# ADR-003: pgvector as Default Vector Store, Qdrant as Optional

**Status:** Accepted  
**Date:** June 2026  

## Context

Iris requires a vector store for:
1. Entity embeddings (semantic search at query time)
2. Semantic cache lookups (nearest-neighbor search over cached query embeddings)

Options evaluated: pgvector (Postgres extension), Qdrant, Pinecone, Weaviate, Milvus.

## Decision

**Default: pgvector.** Optional upgrade path to **Qdrant** for high-volume deployments.

## Rationale

**pgvector (default):**
- Single infrastructure dependency — same Postgres instance used for relational data
- Sufficient performance for SMB/mid-market scale (millions of vectors, not billions)
- `ivfflat` index supports approximate nearest neighbor with acceptable recall at this scale
- Dramatically simpler self-hosted deployment — one Docker container, not two
- Mature tooling: works with every Postgres client, Drizzle ORM, etc.

**Qdrant (optional, Pro/Enterprise):**
- Purpose-built for ANN search at scale (tens of millions+ vectors)
- Supports payload filtering (filter by workspaceId inside the vector index — more efficient than post-filtering)
- Better performance for the semantic cache at high query volumes
- Enable via `ENABLE_QDRANT=true` in environment

## Consequences

- The retrieval layer must be abstract: `VectorStore` interface with `pgvector` and `qdrant` implementations
- pgvector index type: `ivfflat` with `lists = sqrt(record_count)` as a starting point; tune based on recall measurements
- Embedding dimensionality is fixed at 1536 (`text-embedding-3-small`) — changing this requires a full re-index
- Migration from pgvector → Qdrant must be scriptable and documented

## Not Chosen

- **Pinecone:** Managed-only, no self-hosted option — violates our self-hosted requirement for mid-market
- **Weaviate:** More complex operational profile than Qdrant with fewer advantages for our use case
- **Milvus:** Significant operational overhead for the scale we're targeting
