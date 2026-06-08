import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchemaDiscoveryEngine, suggestRelationships } from '../schema-discovery.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

// ─── Pure heuristic tests ─────────────────────────────────────────────────────

describe('suggestRelationships', () => {
  it('detects FK pattern: contact has company_id → company', () => {
    const suggestions = suggestRelationships(
      'contact',
      ['id', 'name', 'email', 'company_id'],
      'company',
      'hubspot'
    );
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]!.heuristic).toBe('fk_pattern');
    expect(suggestions[0]!.confidence).toBe('high');
    expect(suggestions[0]!.viaField).toBe('company_id');
    expect(suggestions[0]!.relationshipType).toBe('belongs_to');
  });

  it('detects camelCase FK: contactId → contact', () => {
    const suggestions = suggestRelationships(
      'deal',
      ['id', 'title', 'contactId'],
      'contact',
      'hubspot'
    );
    expect(suggestions[0]!.heuristic).toBe('fk_pattern');
    expect(suggestions[0]!.confidence).toBe('high');
  });

  it('detects id_suffix pattern: purchase has company_ref_id → company', () => {
    // company_ref_id doesn't exactly match company_id (FK) but stem 'company_ref' includes 'company'
    const suggestions = suggestRelationships(
      'purchase',
      ['id', 'amount', 'company_ref_id'],
      'company',
      'quickbooks'
    );
    expect(suggestions.some(s => s.heuristic === 'id_suffix')).toBe(true);
    expect(suggestions[0]!.confidence).toBe('medium');
  });

  it('detects name similarity: deal_activity references deal', () => {
    const suggestions = suggestRelationships(
      'deal_activity',
      ['id', 'action'],
      'deal',
      'hubspot'
    );
    expect(suggestions.some(s => s.heuristic === 'name_similarity')).toBe(true);
    expect(suggestions[0]!.confidence).toBe('low');
  });

  it('returns empty array when no heuristics match', () => {
    const suggestions = suggestRelationships(
      'user',
      ['id', 'email', 'name'],
      'product',
      'shopify'
    );
    expect(suggestions).toHaveLength(0);
  });

  it('FK pattern takes priority over id_suffix', () => {
    const suggestions = suggestRelationships(
      'order',
      ['id', 'customer_id', 'customer_ref_id'],
      'customer',
      'shopify'
    );
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]!.heuristic).toBe('fk_pattern');
  });

  it('returns high confidence for FK match', () => {
    const suggestions = suggestRelationships(
      'invoice',
      ['id', 'contact_id'],
      'contact',
      'quickbooks'
    );
    expect(suggestions[0]!.confidence).toBe('high');
  });
});

// ─── SchemaDiscoveryEngine class tests ───────────────────────────────────────

function makeSql(results: unknown[] = []) {
  return vi.fn().mockResolvedValue(results) as unknown as ConstructorParameters<typeof SchemaDiscoveryEngine>[0];
}

const CONNECTOR_ID = 'hubspot-prod';

describe('SchemaDiscoveryEngine', () => {
  let engine: SchemaDiscoveryEngine;
  let sql: ReturnType<typeof makeSql>;

  beforeEach(() => {
    sql = makeSql();
    engine = new SchemaDiscoveryEngine(sql);
  });

  describe('detectEntityTypes', () => {
    it('returns empty array when no entities exist', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await engine.detectEntityTypes(CONNECTOR_ID);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('discovers entity types from DB rows', async () => {
      sql
        .mockResolvedValueOnce([
          { entity_type: 'contact', sample_count: 200 },
          { entity_type: 'deal', sample_count: 50 },
        ])
        .mockResolvedValueOnce([
          { attributes: { email: 'alice@corp.com', name: 'Alice', company_id: 'c-1' } },
        ])
        .mockResolvedValueOnce([
          { attributes: { title: 'Big Deal', amount: 50000, contact_id: 'con-1' } },
        ]);

      const result = await engine.detectEntityTypes(CONNECTOR_ID);
      const types = result._unsafeUnwrap();
      expect(types.length).toBe(2);
      expect(types[0]!.entityType).toBe('contact');
      expect(types[0]!.sampleCount).toBe(200);
    });

    it('infers confidence from sample count (≥100 → high)', async () => {
      sql
        .mockResolvedValueOnce([{ entity_type: 'contact', sample_count: 150 }])
        .mockResolvedValueOnce([{ attributes: { name: 'Alice' } }]);

      const result = await engine.detectEntityTypes(CONNECTOR_ID);
      expect(result._unsafeUnwrap()[0]!.confidence).toBe('high');
    });

    it('infers confidence: 10-99 → medium', async () => {
      sql
        .mockResolvedValueOnce([{ entity_type: 'note', sample_count: 15 }])
        .mockResolvedValueOnce([{ attributes: { body: 'Hello' } }]);

      const result = await engine.detectEntityTypes(CONNECTOR_ID);
      expect(result._unsafeUnwrap()[0]!.confidence).toBe('medium');
    });

    it('infers confidence: <10 → low', async () => {
      sql
        .mockResolvedValueOnce([{ entity_type: 'task', sample_count: 3 }])
        .mockResolvedValueOnce([{ attributes: { title: 'Follow up' } }]);

      const result = await engine.detectEntityTypes(CONNECTOR_ID);
      expect(result._unsafeUnwrap()[0]!.confidence).toBe('low');
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValueOnce(new Error('connection refused'));
      const result = await engine.detectEntityTypes(CONNECTOR_ID);
      expect(result.isErr()).toBe(true);
    });

    it('infers field types from attribute sample values', async () => {
      sql
        .mockResolvedValueOnce([{ entity_type: 'deal', sample_count: 20 }])
        .mockResolvedValueOnce([
          { attributes: { amount: 1000, is_won: true, closed_at: '2024-01-01T00:00:00Z' } },
        ]);

      const result = await engine.detectEntityTypes(CONNECTOR_ID);
      const fields = result._unsafeUnwrap()[0]!.fields;
      expect(fields.find(f => f.fieldName === 'amount')?.inferredType).toBe('number');
      expect(fields.find(f => f.fieldName === 'is_won')?.inferredType).toBe('boolean');
      expect(fields.find(f => f.fieldName === 'closed_at')?.inferredType).toBe('date');
    });

    it('computes null rate for fields', async () => {
      sql
        .mockResolvedValueOnce([{ entity_type: 'contact', sample_count: 10 }])
        .mockResolvedValueOnce([
          { attributes: { name: 'Alice', phone: null } },
          { attributes: { name: 'Bob', phone: null } },
          { attributes: { name: 'Carol', phone: '+1-555-1234' } },
        ]);

      const result = await engine.detectEntityTypes(CONNECTOR_ID);
      const fields = result._unsafeUnwrap()[0]!.fields;
      const phoneField = fields.find(f => f.fieldName === 'phone');
      expect(phoneField?.nullRate).toBeCloseTo(2 / 3, 2);
    });
  });

  describe('confirmSuggestion', () => {
    it('updates entity_type_suggestions table', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await engine.confirmSuggestion('s-1', 'entity_type_suggestions');
      expect(result.isOk()).toBe(true);
    });

    it('updates relationship_suggestions table', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await engine.confirmSuggestion('r-1', 'relationship_suggestions');
      expect(result.isOk()).toBe(true);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValueOnce(new Error('update failed'));
      const result = await engine.confirmSuggestion('x', 'entity_type_suggestions');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('generateMappingReport', () => {
    it('returns report with coverage score', async () => {
      // listSuggestions calls: entity types + relationship types (2 SQL calls)
      sql
        .mockResolvedValueOnce([
          {
            suggestion_id: 's-1', connector_id: CONNECTOR_ID, entity_type: 'contact',
            sample_count: 100, fields_json: [{ fieldName: 'email', inferredType: 'string', nullRate: 0, exampleValues: [] }],
            confidence: 'high', confirmed: false, confirmed_at: null,
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await engine.generateMappingReport(CONNECTOR_ID);
      const report = result._unsafeUnwrap();
      expect(report.connectorId).toBe(CONNECTOR_ID);
      expect(report.entityTypes.length).toBe(1);
      expect(report.coverageScore).toBe(1); // 1 type with fields / 1 total
    });
  });
});
