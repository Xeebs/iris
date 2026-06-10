import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import postgres from 'postgres';
import { EnrichmentEngine, type EnrichmentStore, type EnrichmentData } from '../enrichment-engine.js';
import { CompanyEnricher } from '../enrichers/company-enricher.js';
import type { SemanticEntity } from '@iris/connector-sdk';

/**
 * Integration tests for EnrichmentEngine with a real Postgres store.
 * Requires: docker-compose up -d (Postgres on 5432)
 */
const DB_URL = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';

class PostgresEnrichmentStore implements EnrichmentStore {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async get(entityId: string, sourceId: string): Promise<EnrichmentData | null> {
    const [row] = await this.sql<
      { enrichment_data: unknown; confidence_score: string; added_at: Date; expires_at: Date }[]
    >`
      SELECT enrichment_data, confidence_score, added_at, expires_at
      FROM entity_enrichments
      WHERE entity_id = ${entityId} AND enrichment_source = ${sourceId}
        AND expires_at > NOW()
      LIMIT 1
    `;
    if (!row) return null;
    return {
      source: sourceId,
      data: row.enrichment_data as Record<string, unknown>,
      confidenceScore: Number(row.confidence_score),
      fetchedAt: row.added_at,
      expiresAt: row.expires_at,
    };
  }

  async set(entityId: string, data: EnrichmentData): Promise<void> {
    await this.sql`
      INSERT INTO entity_enrichments
        (entity_id, workspace_id, enrichment_source, enrichment_data, confidence_score, added_at, expires_at)
      VALUES (
        ${entityId},
        ${'00000000-0000-0000-0000-000000000001'}::uuid,
        ${data.source},
        ${this.sql.json(data.data)},
        ${data.confidenceScore},
        ${data.fetchedAt},
        ${data.expiresAt}
      )
      ON CONFLICT (entity_id, workspace_id, enrichment_source) DO UPDATE SET
        enrichment_data = EXCLUDED.enrichment_data,
        confidence_score = EXCLUDED.confidence_score,
        added_at = EXCLUDED.added_at,
        expires_at = EXCLUDED.expires_at
    `;
  }

  async getAll(entityId: string): Promise<EnrichmentData[]> {
    const rows = await this.sql<
      { enrichment_source: string; enrichment_data: unknown; confidence_score: string; added_at: Date; expires_at: Date }[]
    >`
      SELECT enrichment_source, enrichment_data, confidence_score, added_at, expires_at
      FROM entity_enrichments
      WHERE entity_id = ${entityId}
      ORDER BY added_at DESC
    `;
    return rows.map((r) => ({
      source: r.enrichment_source,
      data: r.enrichment_data as Record<string, unknown>,
      confidenceScore: Number(r.confidence_score),
      fetchedAt: r.added_at,
      expiresAt: r.expires_at,
    }));
  }

  async isStale(entityId: string, sourceId: string): Promise<boolean> {
    const [row] = await this.sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM entity_enrichments
      WHERE entity_id = ${entityId} AND enrichment_source = ${sourceId} AND expires_at > NOW()
    `;
    return Number(row?.count ?? 0) === 0;
  }

  async markRefreshTriggered(entityId: string, sourceId: string): Promise<void> {
    await this.sql`
      UPDATE entity_enrichments
      SET refresh_triggered_at = NOW()
      WHERE entity_id = ${entityId} AND enrichment_source = ${sourceId}
    `;
  }
}

describe.skipIf(!process.env['DATABASE_URL'])('EnrichmentEngine (integration)', () => {
  let sql: ReturnType<typeof postgres>;
  let store: PostgresEnrichmentStore;

  beforeAll(async () => {
    sql = postgres(DB_URL);
    store = new PostgresEnrichmentStore(sql);
    // Cleanup test data
    await sql`DELETE FROM entity_enrichments WHERE entity_id LIKE 'test:%'`;
  });

  afterAll(async () => {
    await sql`DELETE FROM entity_enrichments WHERE entity_id LIKE 'test:%'`;
    await sql.end();
  });

  it('persists enrichment data and retrieves it on the second call without hitting the source', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ industry: 'SaaS', employees: 250, domain: 'acme.com' }),
    } as Response);

    const source = new CompanyEnricher({ clearbitApiKey: 'test-key', fetch: mockFetch });
    const engine = new EnrichmentEngine({
      sources: [source],
      triggers: [{ entityType: 'contact', sourceIds: ['company-enricher'] }],
      store,
    });

    const entity: SemanticEntity = {
      id: 'test:contact:001',
      type: 'contact',
      label: 'Test User',
      attributes: { domain: 'acme.com' },
      relationships: [],
      lastModified: new Date().toISOString(),
      sourceId: 'test:contact:001',
    };

    // First call — hits API
    const first = await engine.enrichEntity(entity);
    expect(first.get('company-enricher')?.isOk()).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    // Second call — served from DB cache
    const second = await engine.enrichEntity(entity);
    expect(second.get('company-enricher')?.isOk()).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce(); // still only once
  });

  it('getAll returns all enrichments for entity', async () => {
    const enrichments = await store.getAll('test:contact:001');
    expect(enrichments.length).toBeGreaterThanOrEqual(1);
    expect(enrichments[0].source).toBe('company-enricher');
  });

  it('isStale returns false for fresh data and true for expired data', async () => {
    const fresh = await store.isStale('test:contact:001', 'company-enricher');
    expect(fresh).toBe(false);

    // Insert expired record
    const past = new Date(Date.now() - 1000);
    await sql`
      INSERT INTO entity_enrichments
        (entity_id, workspace_id, enrichment_source, enrichment_data, confidence_score, added_at, expires_at)
      VALUES (
        'test:contact:expired',
        ${'00000000-0000-0000-0000-000000000001'}::uuid,
        'company-enricher',
        '{}'::jsonb,
        0.5,
        NOW() - INTERVAL '8 days',
        ${past}
      )
      ON CONFLICT DO NOTHING
    `;

    const stale = await store.isStale('test:contact:expired', 'company-enricher');
    expect(stale).toBe(true);
  });
});
