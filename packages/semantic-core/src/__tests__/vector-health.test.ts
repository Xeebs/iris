import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorHealthService } from '../vector-health.js';
import type { EmbeddingProvider } from '../embedding-provider.js';

function makeProvider(vectors?: number[][]): EmbeddingProvider {
  return {
    getModelId: () => 'test-model',
    getModelDimensions: () => 3,
    getEmbedding: vi.fn().mockResolvedValue([0.5, 0.5, 0.5]),
    batchEmbeddings: vi.fn().mockResolvedValue(vectors ?? [[0.5, 0.5, 0.5]]),
  };
}

function pgVec(v: number[]): string {
  return `[${v.join(',')}]`;
}

function makeSql(responses: Record<string, unknown[][]>): ReturnType<typeof import('postgres')['default']> {
  let callIndex = 0;
  const keys = Object.keys(responses);
  return Object.assign(
    (_strings: TemplateStringsArray) => {
      const key = keys[callIndex % keys.length] ?? 'default';
      const rows = responses[key] ?? [];
      callIndex++;
      return Promise.resolve(rows);
    },
  ) as unknown as ReturnType<typeof import('postgres')['default']>;
}

function makeSeqSql(rowSets: unknown[][]): ReturnType<typeof import('postgres')['default']> {
  let call = 0;
  return Object.assign(
    () => {
      const rows = rowSets[call] ?? [];
      call++;
      return Promise.resolve(rows);
    },
  ) as unknown as ReturnType<typeof import('postgres')['default']>;
}

describe('VectorHealthService.analyzeVectorDrift', () => {
  it('returns 0 when fewer than 2 rows exist', async () => {
    const sql = makeSeqSql([[{ id: 'e1', embedding: pgVec([1, 0, 0]) }]]);
    const service = new VectorHealthService(sql, makeProvider());
    const drift = await service.analyzeVectorDrift('ws-1');
    expect(drift).toBe(0);
  });

  it('returns 0 when no previous health check baseline exists', async () => {
    const sql = makeSeqSql([
      [
        { id: 'e1', embedding: pgVec([1, 0, 0]) },
        { id: 'e2', embedding: pgVec([0, 1, 0]) },
      ],
      [], // No previous check
    ]);
    const service = new VectorHealthService(sql, makeProvider());
    const drift = await service.analyzeVectorDrift('ws-1');
    expect(drift).toBe(0);
  });

  it('returns a score between 0 and 1 when a previous baseline exists', async () => {
    const prevReport = {
      workspaceId: 'ws-1',
      driftScore: 0.3,
      consistencyScore: 0.98,
      outlierCount: 0,
      qualityIssuesCount: 0,
      recommendedActions: ['ok'],
      overallHealthScore: 90,
      sampleSize: 100,
      checkedAt: new Date(),
    };
    const sql = makeSeqSql([
      [
        { id: 'e1', embedding: pgVec([1, 0, 0]) },
        { id: 'e2', embedding: pgVec([0, 1, 0]) },
        { id: 'e3', embedding: pgVec([0, 0, 1]) },
      ],
      [{ report_json: prevReport }],
    ]);
    const service = new VectorHealthService(sql, makeProvider());
    const drift = await service.analyzeVectorDrift('ws-1');
    expect(drift).toBeGreaterThanOrEqual(0);
    expect(drift).toBeLessThanOrEqual(1);
  });
});

describe('VectorHealthService.validateEmbeddingConsistency', () => {
  it('returns 1 for empty entity list', async () => {
    const sql = makeSeqSql([[]]);
    const service = new VectorHealthService(sql, makeProvider());
    expect(await service.validateEmbeddingConsistency([])).toBe(1);
  });

  it('returns 1 when no stored embeddings found', async () => {
    const sql = makeSeqSql([[]]);
    const service = new VectorHealthService(sql, makeProvider());
    expect(await service.validateEmbeddingConsistency(['e1'])).toBe(1);
  });

  it('returns high consistency when re-embeddings match stored', async () => {
    const stored = [0.5, 0.5, 0.5];
    const sql = makeSeqSql([[{
      id: 'e1',
      label: 'Test',
      entity_type: 'contact',
      attributes: {},
      embedding: pgVec(stored),
    }]]);
    const provider = makeProvider([[0.5, 0.5, 0.5]]);
    const service = new VectorHealthService(sql, provider);
    const score = await service.validateEmbeddingConsistency(['e1']);
    expect(score).toBeGreaterThan(0.99);
  });

  it('returns lower consistency when re-embeddings differ significantly', async () => {
    const sql = makeSeqSql([[{
      id: 'e1',
      label: 'Test',
      entity_type: 'contact',
      attributes: {},
      embedding: pgVec([1, 0, 0]),
    }]]);
    // Re-embedding produces orthogonal vector
    const provider = makeProvider([[0, 1, 0]]);
    const service = new VectorHealthService(sql, provider);
    const score = await service.validateEmbeddingConsistency(['e1']);
    expect(score).toBeLessThan(0.5);
  });

  it('returns 1 when embedding provider throws', async () => {
    const sql = makeSeqSql([[{
      id: 'e1', label: 'Test', entity_type: 'record', attributes: {}, embedding: pgVec([1, 0, 0]),
    }]]);
    const provider = makeProvider();
    vi.mocked(provider.batchEmbeddings).mockRejectedValueOnce(new Error('API error'));
    const service = new VectorHealthService(sql, provider);
    const score = await service.validateEmbeddingConsistency(['e1']);
    expect(score).toBe(1); // Graceful fallback
  });
});

describe('VectorHealthService.detectOutliers', () => {
  it('returns empty array when fewer than 3 rows', async () => {
    const sql = makeSeqSql([[
      { id: 'e1', embedding: pgVec([1, 0, 0]) },
      { id: 'e2', embedding: pgVec([0, 1, 0]) },
    ]]);
    const service = new VectorHealthService(sql, makeProvider());
    expect(await service.detectOutliers('ws-1')).toEqual([]);
  });

  it('returns empty array when all vectors are similar (zero std)', async () => {
    const sql = makeSeqSql([[
      { id: 'e1', embedding: pgVec([1, 0, 0]) },
      { id: 'e2', embedding: pgVec([1, 0, 0]) },
      { id: 'e3', embedding: pgVec([1, 0, 0]) },
    ]]);
    const service = new VectorHealthService(sql, makeProvider());
    expect(await service.detectOutliers('ws-1')).toEqual([]);
  });

  it('detects outlier vectors that are far from centroid', async () => {
    // 10 cluster points near [1,0,0] + 1 extreme outlier at [0,0,100].
    // With N=11 the outlier z-score ≈ 3.16, safely above the 2.5 threshold.
    const cluster = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      embedding: pgVec([1 + i * 0.001, 0, 0]),
    }));
    const outlier = { id: 'outlier', embedding: pgVec([0, 0, 100]) };
    const sql = makeSeqSql([[...cluster, outlier]]);
    const service = new VectorHealthService(sql, makeProvider());
    const outliers = await service.detectOutliers('ws-1');
    expect(outliers).toContain('outlier');
    expect(outliers).not.toContain('c0');
  });
});

describe('VectorHealthService.generateHealthReport', () => {
  it('returns a complete health report with all fields', async () => {
    const sql = makeSeqSql([
      [{ count: '50' }],       // entity count
      [],                       // drift: <2 rows → score=0
      [],                       // drift: no baseline
      [],                       // outliers: <3 rows
      [{ id: 'e1' }, { id: 'e2' }], // sample for consistency
      [{ id: 'e1', label: 'A', entity_type: 'c', attributes: {}, embedding: pgVec([1, 0, 0]) },
       { id: 'e2', label: 'B', entity_type: 'c', attributes: {}, embedding: pgVec([0, 1, 0]) }], // consistency fetch
      [],                       // storeHealthCheck
    ]);
    const provider = makeProvider([[1, 0, 0], [0, 1, 0]]);
    const service = new VectorHealthService(sql, provider);
    const report = await service.generateHealthReport('ws-1');
    expect(report.workspaceId).toBe('ws-1');
    expect(report.overallHealthScore).toBeGreaterThanOrEqual(0);
    expect(report.overallHealthScore).toBeLessThanOrEqual(100);
    expect(report.checkedAt).toBeInstanceOf(Date);
    expect(Array.isArray(report.recommendedActions)).toBe(true);
    expect(report.recommendedActions.length).toBeGreaterThan(0);
  });

  it('assigns ok action when no issues detected', async () => {
    const sql = makeSeqSql([
      [{ count: '0' }],
      [], [], [], [], [], [],
    ]);
    const service = new VectorHealthService(sql, makeProvider());
    const report = await service.generateHealthReport('ws-empty');
    expect(report.recommendedActions).toContain('ok');
    expect(report.overallHealthScore).toBe(100);
  });

  it('recommends reindex when drift is high', async () => {
    // Set up scenario where consistency is low
    const sql = makeSeqSql([
      [{ count: '10' }],
      [{ id: 'e1', embedding: pgVec([1, 0, 0]) }, { id: 'e2', embedding: pgVec([0, 1, 0]) }],
      [{ report_json: { driftScore: 0.5, consistencyScore: 0.98, outlierCount: 0, qualityIssuesCount: 0, recommendedActions: ['ok'], overallHealthScore: 90, workspaceId: 'ws-1', sampleSize: 10, checkedAt: new Date() } }],
      [], // outliers: no rows
      [{ id: 'e1' }],
      [{ id: 'e1', label: 'A', entity_type: 'c', attributes: {}, embedding: pgVec([1, 0, 0]) }],
      [],
    ]);
    // Re-embed with very different vector → low consistency
    const provider = makeProvider([[0, 0, 1]]);
    const service = new VectorHealthService(sql, provider);
    const report = await service.generateHealthReport('ws-1');
    expect(report.recommendedActions).toContain('reindex_recommended');
  });
});

describe('VectorHealthService.getHealthHistory', () => {
  it('returns empty array when no checks stored', async () => {
    const sql = makeSeqSql([[]]);
    const service = new VectorHealthService(sql, makeProvider());
    const history = await service.getHealthHistory('ws-1');
    expect(history).toEqual([]);
  });

  it('returns reports from stored checks', async () => {
    const report = {
      workspaceId: 'ws-1', overallHealthScore: 92, driftScore: 0, consistencyScore: 1,
      outlierCount: 0, qualityIssuesCount: 0, recommendedActions: ['ok'],
      sampleSize: 100, checkedAt: new Date(),
    };
    const sql = makeSeqSql([[{ report_json: report }]]);
    const service = new VectorHealthService(sql, makeProvider());
    const history = await service.getHealthHistory('ws-1');
    expect(history.length).toBe(1);
    expect(history[0]!.overallHealthScore).toBe(92);
  });
});

describe('helper: cosineSimilarity (via consistency check)', () => {
  it('identical vectors produce score > 0.99', async () => {
    const v = [0.6, 0.8, 0];
    const sql = makeSeqSql([[{ id: 'e1', label: 'X', entity_type: 'y', attributes: {}, embedding: pgVec(v) }]]);
    const provider = makeProvider([v]);
    const service = new VectorHealthService(sql, provider);
    const score = await service.validateEmbeddingConsistency(['e1']);
    expect(score).toBeGreaterThan(0.99);
  });

  it('zero vector produces score 0', async () => {
    const sql = makeSeqSql([[{ id: 'e1', label: 'X', entity_type: 'y', attributes: {}, embedding: pgVec([1, 0, 0]) }]]);
    const provider = makeProvider([[0, 0, 0]]);
    const service = new VectorHealthService(sql, provider);
    const score = await service.validateEmbeddingConsistency(['e1']);
    expect(score).toBe(0);
  });
});
