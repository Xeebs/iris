import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { createHash } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'benchmarking' });

type SqlClient = ReturnType<typeof postgres>;

export type CompanySize = 'startup' | 'smb' | 'midmarket' | 'enterprise';

export interface WorkspaceMetrics {
  entityCount: number;
  queryCount: number;
  avgContextSizeTokens: number;
  tokenSavingsRatio: number;
  cacheHitRate: number;
  snapshotAt: Date;
}

export interface BenchmarkSettings {
  workspaceId: string;
  benchmarkingEnabled: boolean;
  industry: string | null;
  companySize: CompanySize | null;
}

export interface PercentileResult {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface PeerComparison {
  metric: string;
  workspaceValue: number;
  peerPercentiles: PercentileResult;
  percentileRank: number;
}

export interface BenchmarkReport {
  workspaceId: string;
  metrics: WorkspaceMetrics;
  peerComparisons: PeerComparison[];
  peerCount: number;
}

/**
 * Collects workspace usage metrics and compares them against anonymised peer benchmarks.
 */
export class BenchmarkingService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Collect current metrics for a workspace and persist a snapshot.
   *
   * @param workspaceId - Workspace identifier
   */
  async collectMetrics(workspaceId: string): Promise<Result<WorkspaceMetrics, Error>> {
    try {
      const [entityRow] = await this.sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM entities WHERE workspace_id = ${workspaceId}
      `;
      const entityCount = parseInt(entityRow?.count ?? '0', 10);

      const [queryRow] = await this.sql<{ count: string; avg_tokens: string }[]>`
        SELECT COUNT(*) AS count, COALESCE(AVG(tokens_used), 0) AS avg_tokens
        FROM audit_log
        WHERE workspace_id = ${workspaceId} AND event_type = 'query'
      `;
      const queryCount = parseInt(queryRow?.count ?? '0', 10);
      const avgContextSizeTokens = parseFloat(queryRow?.avg_tokens ?? '0');

      const [savingsRow] = await this.sql<{ ratio: string }[]>`
        SELECT COALESCE(AVG(savings_ratio), 0) AS ratio
        FROM token_events
        WHERE workspace_id = ${workspaceId}
      `;
      const tokenSavingsRatio = Math.min(1, Math.max(0, parseFloat(savingsRow?.ratio ?? '0')));

      const [cacheRow] = await this.sql<{ rate: string }[]>`
        SELECT COALESCE(
          SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0), 0
        ) AS rate
        FROM audit_log
        WHERE workspace_id = ${workspaceId} AND event_type = 'cache_lookup'
      `;
      const cacheHitRate = Math.min(1, Math.max(0, parseFloat(cacheRow?.rate ?? '0')));

      const snapshotAt = new Date();

      await this.sql`
        INSERT INTO workspace_benchmark_snapshots
          (workspace_id, entity_count, query_count, avg_context_size_tokens, token_savings_ratio, cache_hit_rate, snapshotted_at)
        VALUES (
          ${workspaceId}, ${entityCount}, ${queryCount},
          ${avgContextSizeTokens}, ${tokenSavingsRatio}, ${cacheHitRate}, ${snapshotAt}
        )
      `;

      const metrics: WorkspaceMetrics = {
        entityCount,
        queryCount,
        avgContextSizeTokens,
        tokenSavingsRatio,
        cacheHitRate,
        snapshotAt,
      };

      log.info('Metrics collected', { workspaceId, entityCount, queryCount });
      return ok(metrics);
    } catch (e) {
      log.error('Failed to collect metrics', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get or create benchmarking settings for a workspace.
   *
   * @param workspaceId - Workspace identifier
   */
  async getSettings(workspaceId: string): Promise<Result<BenchmarkSettings, Error>> {
    try {
      const [row] = await this.sql<{
        workspace_id: string;
        benchmarking_enabled: boolean;
        industry: string | null;
        company_size: string | null;
      }[]>`
        SELECT * FROM workspace_benchmarking_settings WHERE workspace_id = ${workspaceId}
      `;
      if (!row) {
        return ok({
          workspaceId,
          benchmarkingEnabled: false,
          industry: null,
          companySize: null,
        });
      }
      return ok({
        workspaceId: row.workspace_id,
        benchmarkingEnabled: row.benchmarking_enabled,
        industry: row.industry,
        companySize: row.company_size as CompanySize | null,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Update benchmarking settings (opt-in, industry, company size).
   *
   * @param workspaceId - Workspace identifier
   * @param settings - Partial settings to update
   */
  async updateSettings(
    workspaceId: string,
    settings: Partial<Omit<BenchmarkSettings, 'workspaceId'>>,
  ): Promise<Result<BenchmarkSettings, Error>> {
    try {
      const [row] = await this.sql<{
        workspace_id: string;
        benchmarking_enabled: boolean;
        industry: string | null;
        company_size: string | null;
      }[]>`
        INSERT INTO workspace_benchmarking_settings (workspace_id, benchmarking_enabled, industry, company_size)
        VALUES (${workspaceId}, ${settings.benchmarkingEnabled ?? false}, ${settings.industry ?? null}, ${settings.companySize ?? null})
        ON CONFLICT (workspace_id) DO UPDATE SET
          benchmarking_enabled = COALESCE(${settings.benchmarkingEnabled ?? null}, workspace_benchmarking_settings.benchmarking_enabled),
          industry             = COALESCE(${settings.industry ?? null}, workspace_benchmarking_settings.industry),
          company_size         = COALESCE(${settings.companySize ?? null}, workspace_benchmarking_settings.company_size),
          updated_at           = NOW()
        RETURNING *
      `;
      if (!row) return err(new Error('Settings upsert returned no row'));
      return ok({
        workspaceId: row.workspace_id,
        benchmarkingEnabled: row.benchmarking_enabled,
        industry: row.industry,
        companySize: row.company_size as CompanySize | null,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compare workspace metrics against anonymised peer benchmarks.
   *
   * @param workspaceId - Workspace identifier
   * @param industry - Optional industry filter for peer group
   * @param companySize - Optional company size filter
   */
  async getPeerBenchmarks(
    workspaceId: string,
    industry?: string,
    companySize?: CompanySize,
  ): Promise<Result<BenchmarkReport, Error>> {
    try {
      const [snapshot] = await this.sql<{
        entity_count: string;
        query_count: string;
        avg_context_size_tokens: string;
        token_savings_ratio: string;
        cache_hit_rate: string;
        snapshotted_at: Date;
      }[]>`
        SELECT * FROM workspace_benchmark_snapshots
        WHERE workspace_id = ${workspaceId}
        ORDER BY snapshotted_at DESC
        LIMIT 1
      `;
      if (!snapshot) {
        return err(new Error('No snapshot found — call collectMetrics first'));
      }

      const metrics: WorkspaceMetrics = {
        entityCount: parseInt(snapshot.entity_count, 10),
        queryCount: parseInt(snapshot.query_count, 10),
        avgContextSizeTokens: parseFloat(snapshot.avg_context_size_tokens),
        tokenSavingsRatio: parseFloat(snapshot.token_savings_ratio),
        cacheHitRate: parseFloat(snapshot.cache_hit_rate),
        snapshotAt: snapshot.snapshotted_at,
      };

      const peers = await this.sql<{
        token_savings_ratio: string;
        cache_hit_rate: string;
        entity_count: string;
      }[]>`
        SELECT token_savings_ratio, cache_hit_rate, entity_count
        FROM benchmark_peer_data
        WHERE 1 = 1
          ${industry ? this.sql`AND industry = ${industry}` : this.sql``}
          ${companySize ? this.sql`AND company_size = ${companySize}` : this.sql``}
        ORDER BY submitted_at DESC
        LIMIT 500
      `;

      const peerCount = peers.length;
      const peerComparisons = this.computeComparisons(metrics, peers);

      return ok({ workspaceId, metrics, peerComparisons, peerCount });
    } catch (e) {
      log.error('Failed to get peer benchmarks', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Export anonymised metrics for opt-in contribution to peer benchmarking pool.
   *
   * @param workspaceId - Workspace identifier
   * @param industry - Industry label (attached to the anonymised export)
   * @param companySize - Company size bucket
   */
  async exportMetrics(
    workspaceId: string,
    industry: string,
    companySize: CompanySize,
  ): Promise<Result<void, Error>> {
    try {
      const [snapshot] = await this.sql<{
        entity_count: string;
        query_count: string;
        token_savings_ratio: string;
        cache_hit_rate: string;
      }[]>`
        SELECT entity_count, query_count, token_savings_ratio, cache_hit_rate
        FROM workspace_benchmark_snapshots
        WHERE workspace_id = ${workspaceId}
        ORDER BY snapshotted_at DESC
        LIMIT 1
      `;
      if (!snapshot) return err(new Error('No snapshot to export'));

      const workspaceHash = createHash('sha256').update(workspaceId).digest('hex');

      await this.sql`
        INSERT INTO benchmark_peer_data (workspace_hash, industry, company_size, entity_count, query_count, token_savings_ratio, cache_hit_rate)
        VALUES (
          ${workspaceHash}, ${industry}, ${companySize},
          ${snapshot.entity_count}, ${snapshot.query_count},
          ${snapshot.token_savings_ratio}, ${snapshot.cache_hit_rate}
        )
        ON CONFLICT DO NOTHING
      `;

      log.info('Metrics exported to peer pool', { workspaceHash: workspaceHash.slice(0, 8), industry, companySize });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private computeComparisons(
    metrics: WorkspaceMetrics,
    peers: { token_savings_ratio: string; cache_hit_rate: string; entity_count: string }[],
  ): PeerComparison[] {
    if (peers.length === 0) return [];

    const comparisons: PeerComparison[] = [];
    const fields: { metric: string; workspaceValue: number; peerValues: number[] }[] = [
      {
        metric: 'tokenSavingsRatio',
        workspaceValue: metrics.tokenSavingsRatio,
        peerValues: peers.map((p) => parseFloat(p.token_savings_ratio)),
      },
      {
        metric: 'cacheHitRate',
        workspaceValue: metrics.cacheHitRate,
        peerValues: peers.map((p) => parseFloat(p.cache_hit_rate)),
      },
      {
        metric: 'entityCount',
        workspaceValue: metrics.entityCount,
        peerValues: peers.map((p) => parseInt(p.entity_count, 10)),
      },
    ];

    for (const { metric, workspaceValue, peerValues } of fields) {
      const sorted = [...peerValues].sort((a, b) => a - b);
      const peerPercentiles: PercentileResult = {
        p25: this.percentile(sorted, 25),
        p50: this.percentile(sorted, 50),
        p75: this.percentile(sorted, 75),
        p90: this.percentile(sorted, 90),
      };
      const belowCount = sorted.filter((v) => v <= workspaceValue).length;
      const percentileRank = Math.round((belowCount / sorted.length) * 100);
      comparisons.push({ metric, workspaceValue, peerPercentiles, percentileRank });
    }

    return comparisons;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = ((p / 100) * (sorted.length - 1));
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;
    return (sorted[lo] ?? 0) * (1 - frac) + (sorted[hi] ?? 0) * frac;
  }
}
