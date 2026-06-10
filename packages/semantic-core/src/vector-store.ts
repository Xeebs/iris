import postgres from 'postgres';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';

const log = logger.child({ service: 'vector-store' });

export interface VectorSearchFilter {
  workspaceId?: string;
  entityTypes?: string[];
}

export interface VectorSearchResult {
  entity: SemanticEntity;
  score: number;
}

/**
 * Abstraction over the vector storage backend.
 * All implementations must be able to upsert, search by cosine similarity, and delete.
 */
export interface VectorStore {
  /**
   * Upsert a batch of entities with their pre-computed embedding vectors.
   * Overwrites any existing entry with the same entity id.
   * When workspaceId is omitted, falls back to deriving it from the entity id
   * (legacy behavior — workspace-scoped queries will not match such rows).
   */
  upsert(entities: SemanticEntity[], vectors: number[][], workspaceId?: string): Promise<void>;

  /**
   * Find the top-k most similar entities to a query vector.
   * Results are ordered by descending cosine similarity.
   */
  search(queryVector: number[], topK: number, filter?: VectorSearchFilter): Promise<VectorSearchResult[]>;

  /**
   * Delete entities by their IDs.
   */
  delete(ids: string[]): Promise<void>;

  /**
   * List entities of a given type within a workspace, ordered by most recently modified.
   * Pass `cursor` (ISO timestamp of the last entity from the previous page) for pagination.
   */
  listByType(workspaceId: string, entityType: string, limit: number, cursor?: string): Promise<SemanticEntity[]>;

  /**
   * Retrieve a single entity by its globally unique ID within a workspace.
   * Returns null if not found.
   */
  getById(workspaceId: string, id: string): Promise<SemanticEntity | null>;

  /**
   * BM25 full-text search using Postgres tsvector.
   * Optional — not all VectorStore implementations support lexical search.
   * Requires the fts_vector column (migration 049_add_fts_vector.sql).
   */
  bm25Search?(workspaceId: string, queryText: string, topK: number, entityTypes?: string[]): Promise<VectorSearchResult[]>;
}

/**
 * Normalize a JSONB `relationships` value read from Postgres into the
 * `SemanticEntity['relationships']` array shape.
 *
 * In CI the slice demo provably receives this column as a JSON *string*
 * (pre-2dec8b7 runs crashed iterating it as characters; post-2dec8b7 runs
 * crash on `.map is not a function` after `.length > 0` passes — both are
 * only consistent with a string). Every writer in the current source passes
 * a proper array, so tolerate string/malformed values at the single read
 * choke point instead of letting one bad row poison every query.
 *
 * @param value - Raw column value from a jsonb read
 * @returns A well-formed relationships array (malformed entries dropped)
 */
export function normalizeRelationships(value: unknown): SemanticEntity['relationships'] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      log.warn('relationships column is a non-JSON string; treating as empty', {
        sample: value.slice(0, 80),
      });
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    if (parsed !== null && parsed !== undefined) {
      log.warn('relationships column is not an array; treating as empty', {
        valueType: typeof parsed,
      });
    }
    return [];
  }
  return parsed.filter(
    (r): r is { type: string; targetId: string } =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as { type?: unknown }).type === 'string' &&
      typeof (r as { targetId?: unknown }).targetId === 'string',
  );
}

/**
 * Normalize a JSONB `attributes` value read from Postgres into the
 * `SemanticEntity['attributes']` record shape. Same rationale as
 * {@link normalizeRelationships}: tolerate a double-encoded string.
 *
 * @param value - Raw column value from a jsonb read
 * @returns A plain attribute record (empty when malformed)
 */
export function normalizeAttributes(value: unknown): SemanticEntity['attributes'] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      log.warn('attributes column is a non-JSON string; treating as empty', {
        sample: value.slice(0, 80),
      });
      return {};
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as SemanticEntity['attributes'];
}

/**
 * Postgres + pgvector implementation of VectorStore.
 * Stores entity metadata alongside the embedding vector in a single table.
 */
export class PgvectorStore implements VectorStore {
  private readonly sql: ReturnType<typeof postgres>;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { ssl: false });
  }

  /** Create the entities table if it doesn't exist. Run once at startup. */
  async initialize(): Promise<void> {
    await this.sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS iris_entities (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL,
        type          TEXT NOT NULL,
        label         TEXT NOT NULL,
        attributes    JSONB NOT NULL DEFAULT '{}',
        relationships JSONB NOT NULL DEFAULT '[]',
        last_modified TIMESTAMPTZ NOT NULL,
        source_id     TEXT NOT NULL,
        embedding     vector(1536),
        indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS iris_entities_embedding_idx
      ON iris_entities USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `;
    await this.sql`CREATE INDEX IF NOT EXISTS iris_entities_workspace_idx ON iris_entities (workspace_id)`;
    await this.sql`CREATE INDEX IF NOT EXISTS iris_entities_type_idx ON iris_entities (type)`;

    log.info('PgvectorStore initialized');
  }

  async upsert(entities: SemanticEntity[], vectors: number[][], workspaceId?: string): Promise<void> {
    if (entities.length !== vectors.length) {
      throw new IndexerError('entities and vectors arrays must have the same length');
    }
    if (entities.length === 0) return;

    const rows = entities.map((e, i) => ({
      id: e.id,
      workspace_id: workspaceId ?? extractWorkspaceId(e.id),
      type: e.type,
      label: e.label,
      attributes: JSON.stringify(e.attributes),
      relationships: JSON.stringify(e.relationships),
      last_modified: e.lastModified,
      source_id: e.sourceId,
      embedding: formatVector(vectors[i] ?? []),
    }));

    await this.sql`
      INSERT INTO iris_entities ${this.sql(rows)}
      ON CONFLICT (id) DO UPDATE SET
        label         = EXCLUDED.label,
        attributes    = EXCLUDED.attributes,
        relationships = EXCLUDED.relationships,
        last_modified = EXCLUDED.last_modified,
        embedding     = EXCLUDED.embedding,
        indexed_at    = NOW()
    `;

    log.debug('Upserted entities', { count: entities.length });
  }

  async search(
    queryVector: number[],
    topK: number,
    filter?: VectorSearchFilter,
  ): Promise<VectorSearchResult[]> {
    const vecStr = formatVector(queryVector);

    const rows = await this.sql<
      Array<{
        id: string;
        type: string;
        label: string;
        attributes: unknown;
        relationships: unknown;
        last_modified: Date;
        source_id: string;
        score: number;
      }>
    >`
      SELECT
        id, type, label, attributes, relationships, last_modified, source_id,
        1 - (embedding <=> ${vecStr}::vector) AS score
      FROM iris_entities
      WHERE TRUE
        ${filter?.workspaceId ? this.sql`AND workspace_id = ${filter.workspaceId}` : this.sql``}
        ${filter?.entityTypes?.length ? this.sql`AND type = ANY(${filter.entityTypes})` : this.sql``}
      ORDER BY embedding <=> ${vecStr}::vector
      LIMIT ${topK}
    `;

    return rows.map((r) => ({
      entity: {
        id: r.id,
        type: r.type,
        label: r.label,
        attributes: normalizeAttributes(r.attributes),
        relationships: normalizeRelationships(r.relationships),
        lastModified: r.last_modified,
        sourceId: r.source_id,
      },
      score: r.score,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.sql`DELETE FROM iris_entities WHERE id = ANY(${ids})`;
    log.debug('Deleted entities', { count: ids.length });
  }

  async listByType(workspaceId: string, entityType: string, limit: number, cursor?: string): Promise<SemanticEntity[]> {
    const rows = await this.sql<
      Array<{
        id: string;
        type: string;
        label: string;
        attributes: unknown;
        relationships: unknown;
        last_modified: Date;
        source_id: string;
      }>
    >`
      SELECT id, type, label, attributes, relationships, last_modified, source_id
      FROM iris_entities
      WHERE workspace_id = ${workspaceId} AND type = ${entityType}
        ${cursor ? this.sql`AND last_modified < ${cursor}::timestamptz` : this.sql``}
      ORDER BY last_modified DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      label: r.label,
      attributes: normalizeAttributes(r.attributes),
      relationships: normalizeRelationships(r.relationships),
      lastModified: r.last_modified,
      sourceId: r.source_id,
    }));
  }

  async getById(workspaceId: string, id: string): Promise<SemanticEntity | null> {
    const rows = await this.sql<
      Array<{
        id: string;
        type: string;
        label: string;
        attributes: unknown;
        relationships: unknown;
        last_modified: Date;
        source_id: string;
      }>
    >`
      SELECT id, type, label, attributes, relationships, last_modified, source_id
      FROM iris_entities
      WHERE workspace_id = ${workspaceId} AND id = ${id}
      LIMIT 1
    `;

    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      type: r.type,
      label: r.label,
      attributes: normalizeAttributes(r.attributes),
      relationships: normalizeRelationships(r.relationships),
      lastModified: r.last_modified,
      sourceId: r.source_id,
    };
  }

  /**
   * Full-text BM25 search using Postgres ts_rank_cd.
   * Requires migrations 049_add_fts_vector.sql and 175_fts_vector_attributes.sql.
   *
   * Terms are OR-combined (via websearch_to_tsquery), not AND-combined: natural
   * language questions routinely contain words absent from the corpus ("how many",
   * "total value"), and plainto_tsquery's implicit AND made such queries match
   * zero rows, silently disabling the lexical leg of hybrid retrieval. With OR
   * semantics, ts_rank_cd still ranks entities matching more terms higher.
   *
   * @param workspaceId - Workspace to search within
   * @param queryText   - Natural language query (tokenized into an OR tsquery)
   * @param topK        - Maximum results to return
   * @param entityTypes - Optional entity type filter
   */
  async bm25Search(
    workspaceId: string,
    queryText: string,
    topK: number,
    entityTypes?: string[],
  ): Promise<VectorSearchResult[]> {
    type BM25Row = {
      id: string;
      type: string;
      label: string;
      attributes: unknown;
      relationships: unknown;
      last_modified: Date;
      source_id: string;
      score: number;
    };

    const terms = queryText
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((t) => t.length > 1 && t !== 'or' && t !== 'and');
    if (terms.length === 0) return [];
    const orQuery = terms.join(' or ');

    const rows = await this.sql<BM25Row[]>`
      SELECT
        id, type, label, attributes, relationships, last_modified, source_id,
        ts_rank_cd(fts_vector, websearch_to_tsquery('english', ${orQuery})) AS score
      FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        AND fts_vector @@ websearch_to_tsquery('english', ${orQuery})
        ${entityTypes?.length ? this.sql`AND type = ANY(${entityTypes})` : this.sql``}
      ORDER BY score DESC
      LIMIT ${topK}
    `;

    return rows.map((r) => ({
      entity: {
        id: r.id,
        type: r.type,
        label: r.label,
        attributes: normalizeAttributes(r.attributes),
        relationships: normalizeRelationships(r.relationships),
        lastModified: r.last_modified,
        sourceId: r.source_id,
      },
      score: r.score,
    }));
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

function formatVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

function extractWorkspaceId(entityId: string): string {
  // Entity IDs are: connector:type:externalId
  // workspace_id is stored separately in production; here we use a default
  return entityId.split(':')[0] ?? 'default';
}
