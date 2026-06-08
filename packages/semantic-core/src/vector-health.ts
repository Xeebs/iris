import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

import type { EmbeddingProvider } from './embedding-provider.js';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ service: 'vector-health' });

const OUTLIER_Z_THRESHOLD = 2.0;
const CONSISTENCY_DRIFT_THRESHOLD = 0.05;

export type HealthAction = 'reindex_recommended' | 'investigate_outliers' | 'ok';

export type VectorHealthReport = {
  workspaceId: string;
  overallHealthScore: number;
  driftScore: number;
  consistencyScore: number;
  outlierCount: number;
  qualityIssuesCount: number;
  recommendedActions: HealthAction[];
  sampleSize: number;
  checkedAt: Date;
};

type StoredHealthCheck = {
  workspace_id: string;
  check_timestamp: Date;
  drift_score: number;
  outlier_count: number;
  consistency_score: number;
  report_json: VectorHealthReport;
};

type EntityVector = {
  id: string;
  label: string;
  entity_type: string;
  attributes: Record<string, unknown>;
  embedding: number[];
};

function parsePgVector(raw: string | number[]): number[] {
  if (Array.isArray(raw)) return raw;
  return raw.replace(/[[\]]/g, '').split(',').map(Number);
}

/**
 * Compute the centroid (element-wise mean) of a set of vectors.
 */
function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0]!.length;
  const centroid = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      centroid[i]! += v[i]!;
    }
  }
  return centroid.map((x) => x / vectors.length);
}

/**
 * Compute Euclidean distance between two vectors.
 */
function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i]! - b[i]!) ** 2;
  }
  return Math.sqrt(sum);
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorHealthService {
  constructor(
    private readonly sql: SqlClient,
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  /**
   * Analyze vector distribution to detect drift.
   * Computes centroid and mean distance; compares to previous check if available.
   *
   * @param workspaceId - Target workspace
   * @param sampleSize  - Number of entities to sample (default: 1000)
   * @returns           - Drift score in [0, 1]; 0 = no drift, 1 = high drift
   */
  async analyzeVectorDrift(workspaceId: string, sampleSize = 1000): Promise<number> {
    const rows = await this.sql<{ id: string; embedding: string }[]>`
      SELECT id, embedding::text
      FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        AND embedding IS NOT NULL
      ORDER BY random()
      LIMIT ${sampleSize}
    `;

    if (rows.length < 2) return 0;

    const vectors = rows.map((r) => parsePgVector(r.embedding));
    const centroid = computeCentroid(vectors);
    const distances = vectors.map((v) => euclideanDistance(v, centroid));
    const meanDist = distances.reduce((s, d) => s + d, 0) / distances.length;

    const prev = await this.getPreviousCheck(workspaceId);
    if (!prev) {
      // No baseline — can't compute drift yet
      log.info('No previous health check for drift baseline', { workspaceId, meanDist });
      return 0;
    }

    // Drift score based on relative change in mean centroid distance
    const prevMeanDist = prev.report_json.driftScore;
    if (prevMeanDist === 0) return 0;
    const relativeChange = Math.abs(meanDist - prevMeanDist) / prevMeanDist;
    return Math.min(1, relativeChange);
  }

  /**
   * Validate embedding consistency by re-embedding a sample and comparing to stored vectors.
   * Returns a consistency score in [0, 1]; 1 = fully consistent, 0 = fully inconsistent.
   *
   * @param entityIds - Entity IDs to validate (sample)
   */
  async validateEmbeddingConsistency(entityIds: string[]): Promise<number> {
    if (entityIds.length === 0) return 1;

    const rows = await this.sql<EntityVector[]>`
      SELECT id, label, entity_type, attributes, embedding::text AS embedding
      FROM iris_entities
      WHERE id = ANY(${entityIds})
        AND embedding IS NOT NULL
    `;

    if (rows.length === 0) return 1;

    const texts = rows.map((r) => {
      const attrs = Object.entries(r.attributes ?? {})
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(', ') : String(v)}`)
        .join('; ');
      return `${r.entity_type}: ${r.label}${attrs ? `. ${attrs}` : ''}`;
    });

    let newVectors: number[][];
    try {
      newVectors = await this.embeddingProvider.batchEmbeddings(texts);
    } catch (e) {
      log.warn('Consistency check embedding failed', { error: e });
      return 1;
    }

    const similarities = rows.map((r, i) => {
      const stored = parsePgVector(r.embedding as unknown as string);
      return cosineSimilarity(stored, newVectors[i]!);
    });

    const meanSimilarity = similarities.reduce((s, x) => s + x, 0) / similarities.length;
    return meanSimilarity;
  }

  /**
   * Detect statistical outliers using z-score on centroid distances.
   * Returns entity IDs with |z-score| > OUTLIER_Z_THRESHOLD.
   *
   * @param workspaceId - Target workspace
   * @param sampleSize  - Number of entities to examine
   */
  async detectOutliers(workspaceId: string, sampleSize = 1000): Promise<string[]> {
    const rows = await this.sql<{ id: string; embedding: string }[]>`
      SELECT id, embedding::text
      FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        AND embedding IS NOT NULL
      ORDER BY random()
      LIMIT ${sampleSize}
    `;

    if (rows.length < 3) return [];

    const vectors = rows.map((r) => parsePgVector(r.embedding));
    const centroid = computeCentroid(vectors);
    const distances = vectors.map((v) => euclideanDistance(v, centroid));

    const mean = distances.reduce((s, d) => s + d, 0) / distances.length;
    const variance = distances.reduce((s, d) => s + (d - mean) ** 2, 0) / distances.length;
    const std = Math.sqrt(variance);

    if (std === 0) return [];

    const outlierIds: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const z = Math.abs((distances[i]! - mean) / std);
      if (z > OUTLIER_Z_THRESHOLD) {
        outlierIds.push(rows[i]!.id);
      }
    }

    return outlierIds;
  }

  /**
   * Generate a comprehensive health report for a workspace.
   * Aggregates drift, consistency, and outlier metrics into an overall score.
   *
   * @param workspaceId - Target workspace
   * @param sampleSize  - Sample size for vector analysis
   */
  async generateHealthReport(workspaceId: string, sampleSize = 1000): Promise<VectorHealthReport> {
    const entityCountRows = await this.sql<{ count: string }[]>`
      SELECT count(*)::text FROM iris_entities WHERE workspace_id = ${workspaceId}
    `;
    const totalEntities = parseInt(entityCountRows[0]?.count ?? '0', 10);
    const actualSample = Math.min(sampleSize, totalEntities);

    const [driftScore, outlierIds] = await Promise.all([
      this.analyzeVectorDrift(workspaceId, actualSample),
      this.detectOutliers(workspaceId, actualSample),
    ]);

    // Sample entity IDs for consistency check (up to 100)
    const sampleRows = await this.sql<{ id: string }[]>`
      SELECT id FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        AND embedding IS NOT NULL
      ORDER BY random()
      LIMIT 100
    `;
    const consistencyScore = await this.validateEmbeddingConsistency(sampleRows.map((r) => r.id));
    const consistencyDrift = 1 - consistencyScore;

    const qualityIssuesCount =
      (driftScore > 0.1 ? 1 : 0) +
      (consistencyDrift > CONSISTENCY_DRIFT_THRESHOLD ? 1 : 0) +
      (outlierIds.length > 0 ? 1 : 0);

    // Health score: 100 - penalties
    const driftPenalty = Math.round(driftScore * 30);
    const consistencyPenalty = Math.round(consistencyDrift * 40);
    const outlierPenalty = Math.min(30, outlierIds.length * 3);
    const overallHealthScore = Math.max(0, 100 - driftPenalty - consistencyPenalty - outlierPenalty);

    const recommendedActions: HealthAction[] = [];
    if (driftScore > 0.1 || consistencyDrift > CONSISTENCY_DRIFT_THRESHOLD) {
      recommendedActions.push('reindex_recommended');
    }
    if (outlierIds.length > 0) {
      recommendedActions.push('investigate_outliers');
    }
    if (recommendedActions.length === 0) {
      recommendedActions.push('ok');
    }

    const report: VectorHealthReport = {
      workspaceId,
      overallHealthScore,
      driftScore,
      consistencyScore,
      outlierCount: outlierIds.length,
      qualityIssuesCount,
      recommendedActions,
      sampleSize: actualSample,
      checkedAt: new Date(),
    };

    await this.storeHealthCheck(report);

    log.info('Vector health report generated', {
      workspaceId,
      overallHealthScore,
      driftScore,
      consistencyScore,
      outlierCount: outlierIds.length,
    });

    return report;
  }

  /**
   * Get health check history for a workspace.
   *
   * @param workspaceId - Target workspace
   * @param limit       - Max number of historical checks to return
   */
  async getHealthHistory(workspaceId: string, limit = 30): Promise<VectorHealthReport[]> {
    const rows = await this.sql<{ report_json: VectorHealthReport }[]>`
      SELECT report_json
      FROM vector_health_checks
      WHERE workspace_id = ${workspaceId}
      ORDER BY check_timestamp DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => r.report_json);
  }

  private async getPreviousCheck(workspaceId: string): Promise<StoredHealthCheck | null> {
    const rows = await this.sql<StoredHealthCheck[]>`
      SELECT * FROM vector_health_checks
      WHERE workspace_id = ${workspaceId}
      ORDER BY check_timestamp DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async storeHealthCheck(report: VectorHealthReport): Promise<void> {
    await this.sql`
      INSERT INTO vector_health_checks
        (workspace_id, check_timestamp, drift_score, outlier_count, consistency_score, report_json)
      VALUES
        (${report.workspaceId}, ${report.checkedAt}, ${report.driftScore},
         ${report.outlierCount}, ${report.consistencyScore}, ${JSON.stringify(report)})
    `;
  }
}
