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
   */
  upsert(entities: SemanticEntity[], vectors: number[][]): Promise<void>;

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

  async upsert(entities: SemanticEntity[], vectors: number[][]): Promise<void> {
    if (entities.length !== vectors.length) {
      throw new IndexerError('entities and vectors arrays must have the same length');
    }
    if (entities.length === 0) return;

    const rows = entities.map((e, i) => ({
      id: e.id,
      workspace_id: extractWorkspaceId(e.id),
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
        attributes: Record<string, unknown>;
        relationships: Array<{ type: string; targetId: string }>;
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
        attributes: r.attributes as SemanticEntity['attributes'],
        relationships: r.relationships,
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
        attributes: Record<string, unknown>;
        relationships: Array<{ type: string; targetId: string }>;
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
      attributes: r.attributes as SemanticEntity['attributes'],
      relationships: r.relationships,
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
        attributes: Record<string, unknown>;
        relationships: Array<{ type: string; targetId: string }>;
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
      attributes: r.attributes as SemanticEntity['attributes'],
      relationships: r.relationships,
      lastModified: r.last_modified,
      sourceId: r.source_id,
    };
  }

  /**
   * Full-text BM25 search using Postgres ts_rank_cd.
   * Requires migration 049_add_fts_vector.sql to have run.
   *
   * @param workspaceId - Workspace to search within
   * @param queryText   - Natural language query (converted to tsquery via plainto_tsquery)
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
      attributes: Record<string, unknown>;
      relationships: Array<{ type: string; targetId: string }>;
      last_modified: Date;
      source_id: string;
      score: number;
    };

    const rows = await this.sql<BM25Row[]>`
      SELECT
        id, type, label, attributes, relationships, last_modified, source_id,
        ts_rank_cd(fts_vector, plainto_tsquery('english', ${queryText})) AS score
      FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        AND fts_vector @@ plainto_tsquery('english', ${queryText})
        ${entityTypes?.length ? this.sql`AND type = ANY(${entityTypes})` : this.sql``}
      ORDER BY score DESC
      LIMIT ${topK}
    `;

    return rows.map((r) => ({
      entity: {
        id: r.id,
        type: r.type,
        label: r.label,
        attributes: r.attributes as SemanticEntity['attributes'],
        relationships: r.relationships,
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
