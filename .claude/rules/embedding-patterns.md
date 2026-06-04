# Embedding Patterns

Embeddings are central to Iris's core value (semantic search, deduplication, cache lookup). Incorrect usage here degrades product quality and inflates cost. These rules are non-negotiable.

## Model Choice

**Default model: `text-embedding-3-small` (OpenAI)**
- Dimensionality: 1536
- Cost: ~$0.02 / 1M tokens (as of mid-2026)
- Sufficient quality for entity search and deduplication at SMB/mid-market scale

**Large model: `text-embedding-3-large`** — only used for high-precision semantic cache lookups if quality issues are measured with `small`. Never default to large; cost is 5× higher.

**One model across the entire system.** Never mix models for index-time and query-time embeddings — similarity scores will be meaningless. If the model changes, a full re-index is required.

## What to Embed

Embed a structured string representation of the entity, not raw JSON. The embedding input controls what is semantically searchable.

```typescript
// GOOD — semantic representation optimized for search
function buildEmbeddingInput(entity: SemanticEntity): string {
  const attrs = Object.entries(entity.attributes)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('; ');
  return `${entity.type}: ${entity.label}. ${attrs}`;
}

// BAD — raw JSON is noisy and wastes tokens on structural syntax
JSON.stringify(entity)
```

## Batching

- Always batch embedding API calls: never call the API one entity at a time
- Default batch size: 100 entities per API call (see `IndexerConfig.batchSize`)
- Stay within the model's token limit: `text-embedding-3-small` max input is 8191 tokens
- If a single entity's embedding input exceeds 512 tokens, truncate and log a warning — an over-long input usually means the transformer is including raw data instead of a semantic summary

## Dimensionality and Storage

- Store embeddings as `vector(1536)` in Postgres (pgvector) or as native Qdrant vectors
- Never store embeddings in application memory across requests — too large, not shared across instances
- Index type for pgvector: `ivfflat` with `lists` tuned to the dataset size (start: `sqrt(row_count)`)

## Cosine Similarity Thresholds

| Use Case | Threshold | Notes |
|----------|-----------|-------|
| Semantic deduplication | 0.85 | Entities above this threshold are considered the same logical entity |
| Semantic cache hit | 0.92 | Higher threshold — a wrong cache hit is worse than a miss |
| Related entity suggestion | 0.70 | Lower threshold acceptable for "you might also want to know" context expansion |

These are defaults. Measure recall and precision against real customer data and adjust per connector type.

## Cost Control

- Embeddings are generated at index time, not query time for entities — query embeddings are the only per-request embedding cost
- Log embedding API latency and token counts per batch to the audit table
- Set a hard budget cap per sync run: if a sync would embed more than 500K tokens, warn and require explicit confirmation
- Cache query embeddings for the duration of the MCP request — a single query-context call should only generate one embedding

## Sensitive Data

- Never embed raw PII fields (email addresses, phone numbers, SSNs) — embed the entity's label and non-PII attributes only
- Fields marked `pii: true` in the connector schema must be excluded from the embedding input
