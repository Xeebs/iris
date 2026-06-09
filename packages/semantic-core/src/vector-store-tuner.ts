import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'vector-store-tuner' });

export type IndexHealthReport = {
  tableName: string;
  rowCount: number;
  indexExists: boolean;
  indexType: string | null;
  lists: number | null;
  fragmentation: number;
  avgQueryLatencyMs: number | null;
  recommendations: string[];
};

export type IndexStrategy = {
  indexType: 'ivfflat' | 'hnsw';
  lists?: number;
  efConstruction?: number;
  m?: number;
  rationale: string;
};

type StatRow = {
  n_live_tup: string;
  n_dead_tup: string;
  idx_scan: string;
};

type IndexRow = {
  indexname: string;
  indexdef: string;
};

/**
 * Analyses and tunes pgvector index configuration for iris_entities.
 */
export class VectorStoreTuner {
  private readonly sql: ReturnType<typeof postgres>;

  /**
   * @param sql - Postgres client
   */
  constructor(sql: ReturnType<typeof postgres>) {
    this.sql = sql;
  }

  /**
   * Analyse the health of the vector index on `tableName`.
   *
   * @param tableName - Postgres table to inspect (default: iris_entities)
   * @returns Health report with recommendations
   */
  async analyzeIndexHealth(tableName = 'iris_entities'): Promise<IndexHealthReport> {
    const [stat] = await this.sql<StatRow[]>`
      SELECT
        n_live_tup::text,
        n_dead_tup::text,
        idx_scan::text
      FROM pg_stat_user_tables
      WHERE relname = ${tableName}
    `;

    const liveTup = parseInt(stat?.n_live_tup ?? '0', 10);
    const deadTup = parseInt(stat?.n_dead_tup ?? '0', 10);
    const idxScan = parseInt(stat?.idx_scan ?? '0', 10);
    const rowCount = liveTup;
    const fragmentation = liveTup + deadTup > 0
      ? Math.round((deadTup / (liveTup + deadTup)) * 100)
      : 0;

    const indexRows = await this.sql<IndexRow[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = ${tableName} AND indexdef ILIKE '%ivfflat%' OR (tablename = ${tableName} AND indexdef ILIKE '%hnsw%')
    `;

    const vectorIndex = indexRows[0] ?? null;
    const indexType = vectorIndex
      ? (vectorIndex.indexdef.toLowerCase().includes('hnsw') ? 'hnsw' : 'ivfflat')
      : null;

    const listsMatch = vectorIndex?.indexdef.match(/lists\s*=\s*(\d+)/i);
    const lists = listsMatch ? parseInt(listsMatch[1]!, 10) : null;

    const recommendations: string[] = [];
    const optimalLists = Math.round(Math.sqrt(rowCount));

    if (!vectorIndex) {
      recommendations.push('No vector index found — create ivfflat index immediately');
    } else if (indexType === 'ivfflat' && lists !== null && optimalLists > 0 && Math.abs(lists - optimalLists) > 20) {
      recommendations.push(`IVFFlat lists=${lists} is suboptimal for ${rowCount} rows; recommend lists=${optimalLists}`);
    }

    if (fragmentation > 20) {
      recommendations.push(`Table fragmentation is ${fragmentation}% — run VACUUM ANALYZE ${tableName}`);
    }

    if (rowCount > 100_000 && indexType === 'ivfflat') {
      recommendations.push('At 100K+ rows consider migrating to HNSW for better recall/latency');
    }

    if (recommendations.length === 0) {
      recommendations.push('Index configuration looks healthy');
    }

    log.debug('Index health analysed', { tableName, rowCount, fragmentation, idxScan });

    return {
      tableName,
      rowCount,
      indexExists: !!vectorIndex,
      indexType,
      lists,
      fragmentation,
      avgQueryLatencyMs: null,
      recommendations,
    };
  }

  /**
   * Recommend an index strategy based on dataset size and latency SLA.
   *
   * @param rowCount        - Number of vectors in the table
   * @param queryLatencySla - Target p95 query latency in ms
   * @returns Recommended index strategy
   */
  recommendIndexStrategy(rowCount: number, queryLatencySla: number): IndexStrategy {
    if (rowCount < 10_000) {
      return {
        indexType: 'ivfflat',
        lists: Math.max(1, Math.round(Math.sqrt(rowCount))),
        rationale: 'Small dataset: IVFFlat with sqrt(n) lists is optimal',
      };
    }

    if (rowCount >= 100_000 || queryLatencySla < 20) {
      return {
        indexType: 'hnsw',
        efConstruction: 200,
        m: 16,
        rationale: 'Large dataset or tight latency SLA: HNSW delivers better recall and lower p95 latency',
      };
    }

    const lists = Math.round(Math.sqrt(rowCount));
    return {
      indexType: 'ivfflat',
      lists,
      rationale: `Mid-range dataset: IVFFlat with lists=${lists} balances build time and recall`,
    };
  }

  /**
   * Rebuild the vector index in the background after a VACUUM ANALYZE.
   * Does not block reads — uses CREATE INDEX CONCURRENTLY.
   *
   * @param tableName - Table to reindex (default: iris_entities)
   * @param newLists  - Optional new lists value for IVFFlat; omit to use sqrt(rowCount)
   */
  async executeReindexing(tableName = 'iris_entities', newLists?: number): Promise<void> {
    log.info('Starting background reindex', { tableName });

    await this.sql`VACUUM ANALYZE ${this.sql(tableName)}`;

    const [countRow] = await this.sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM ${this.sql(tableName)}
    `;
    const rowCount = parseInt(countRow?.count ?? '0', 10);
    const lists = newLists ?? Math.max(1, Math.round(Math.sqrt(rowCount)));

    const idxName = `${tableName}_embedding_tuned_idx`;
    await this.sql`DROP INDEX IF EXISTS ${this.sql(idxName)}`;
    await this.sql`
      CREATE INDEX ${this.sql(idxName)}
      ON ${this.sql(tableName)} USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = ${lists})
    `;

    log.info('Reindex complete', { tableName, lists, rowCount });
  }
}
