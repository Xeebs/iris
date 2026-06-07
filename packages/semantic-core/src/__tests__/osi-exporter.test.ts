import { describe, it, expect, vi } from 'vitest';
import {
  entityToOsiNode,
  glossaryTermToOsiNode,
  metricToOsiNode,
  exportToOSI,
} from '../osi-exporter.js';

// ─── entityToOsiNode ──────────────────────────────────────────────────────────

describe('entityToOsiNode', () => {
  const base = {
    id: 'hubspot:contact:123',
    type: 'contact',
    label: 'Alice Smith',
    attributes: { stage: 'qualified', revenue: 50000 },
    relationships: [{ type: 'belongs_to', targetId: 'hubspot:company:456' }],
    last_modified: new Date('2026-06-01T00:00:00Z'),
    source_id: 'hubspot:contact:123',
  };

  it('sets @id and @type correctly', () => {
    const node = entityToOsiNode(base);
    expect(node['@id']).toBe('hubspot:contact:123');
    expect(node['@type']).toBe('iris:contact');
  });

  it('includes label and sourceId', () => {
    const node = entityToOsiNode(base);
    expect(node['label']).toBe('Alice Smith');
    expect(node['sourceId']).toBe('hubspot:contact:123');
  });

  it('includes lastModified as ISO string', () => {
    const node = entityToOsiNode(base);
    expect(node['lastModified']).toBe('2026-06-01T00:00:00.000Z');
  });

  it('spreads non-null attributes into the node', () => {
    const node = entityToOsiNode(base);
    expect(node['stage']).toBe('qualified');
    expect(node['revenue']).toBe(50000);
  });

  it('excludes null attribute values', () => {
    const row = { ...base, attributes: { name: null, stage: 'qualified' } };
    const node = entityToOsiNode(row);
    expect('name' in node).toBe(false);
    expect(node['stage']).toBe('qualified');
  });

  it('maps relationships to iris:relatedTo array', () => {
    const node = entityToOsiNode(base);
    const related = node['iris:relatedTo'] as Array<{ '@type': string; '@id': string }>;
    expect(related).toHaveLength(1);
    expect(related[0]!['@type']).toBe('iris:belongs_to');
    expect(related[0]!['@id']).toBe('hubspot:company:456');
  });

  it('omits iris:relatedTo when no relationships', () => {
    const row = { ...base, relationships: [] };
    const node = entityToOsiNode(row);
    expect('iris:relatedTo' in node).toBe(false);
  });
});

// ─── glossaryTermToOsiNode ────────────────────────────────────────────────────

describe('glossaryTermToOsiNode', () => {
  it('sets @id, @type, label, and definition', () => {
    const node = glossaryTermToOsiNode({
      id: 'term-1',
      term: 'ARR',
      definition: 'Annual Recurring Revenue',
      example_value: '1200000',
    });
    expect(node['@id']).toBe('iris:glossary:term-1');
    expect(node['@type']).toBe('iris:GlossaryTerm');
    expect(node['label']).toBe('ARR');
    expect(node['definition']).toBe('Annual Recurring Revenue');
    expect(node['exampleValue']).toBe('1200000');
  });

  it('omits exampleValue when null', () => {
    const node = glossaryTermToOsiNode({
      id: 't2',
      term: 'CAC',
      definition: 'Customer Acquisition Cost',
      example_value: null,
    });
    expect('exampleValue' in node).toBe(false);
  });
});

// ─── metricToOsiNode ──────────────────────────────────────────────────────────

describe('metricToOsiNode', () => {
  it('maps metric fields correctly', () => {
    const node = metricToOsiNode({
      id: 'metric-1',
      name: 'MRR',
      formula: 'SUM(monthly_revenue)',
      description: 'Monthly Recurring Revenue',
    });
    expect(node['@id']).toBe('iris:metric:metric-1');
    expect(node['@type']).toBe('iris:Metric');
    expect(node['label']).toBe('MRR');
    expect(node['formula']).toBe('SUM(monthly_revenue)');
    expect(node['definition']).toBe('Monthly Recurring Revenue');
  });
});

// ─── exportToOSI ─────────────────────────────────────────────────────────────

describe('exportToOSI', () => {
  const entityRows = [
    {
      id: 'hubspot:contact:1',
      type: 'contact',
      label: 'Alice',
      attributes: { stage: 'qualified' },
      relationships: [],
      last_modified: new Date('2026-01-01'),
      source_id: 'hubspot:contact:1',
    },
  ];

  const glossaryRows = [
    { id: 'g1', term: 'ARR', definition: 'Annual Recurring Revenue', example_value: null },
  ];

  const metricRows = [
    { id: 'm1', name: 'MRR', formula: 'SUM(rev)', description: 'Monthly RR' },
  ];

  function makeSql(
    entities = entityRows,
    glossary = glossaryRows,
    metrics = metricRows,
  ) {
    let queryCall = 0;
    return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('');
      // Fragment calls (sub-sql template tags for conditional clauses) return an
      // inert object so they don't consume the query counter.
      if (!sql.includes('SELECT') && !sql.includes('FROM')) {
        return { strings, values } as unknown as Promise<unknown[]>;
      }
      const result = [entities, glossary, metrics][queryCall++] ?? [];
      return Promise.resolve(result);
    }) as unknown as ReturnType<typeof import('postgres').default>;
  }

  it('returns an OsiDocument with correct structure', async () => {
    const result = await exportToOSI('ws-1', {}, makeSql());
    expect(result.isOk()).toBe(true);
    const doc = result._unsafeUnwrap();
    expect(doc.workspaceId).toBe('ws-1');
    expect(doc['@context']['@vocab']).toBeDefined();
    expect(Array.isArray(doc['@graph'])).toBe(true);
  });

  it('includes entity, glossary, and metric nodes', async () => {
    const result = await exportToOSI('ws-1', {}, makeSql());
    const doc = result._unsafeUnwrap();
    expect(doc.totalNodes).toBe(3);
    const types = doc['@graph'].map(n => n['@type']);
    expect(types).toContain('iris:contact');
    expect(types).toContain('iris:GlossaryTerm');
    expect(types).toContain('iris:Metric');
  });

  it('excludes glossary when includeGlossary=false', async () => {
    let call = 0;
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const s = strings.join('');
      if (!s.includes('SELECT') && !s.includes('FROM')) return { strings, values } as unknown as Promise<unknown[]>;
      const result = [entityRows, metricRows][call++] ?? [];
      return Promise.resolve(result);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const result = await exportToOSI('ws-1', { includeGlossary: false }, sql);
    const doc = result._unsafeUnwrap();
    const types = doc['@graph'].map(n => n['@type']);
    expect(types).not.toContain('iris:GlossaryTerm');
    expect(types).toContain('iris:Metric');
  });

  it('excludes metrics when includeMetrics=false', async () => {
    let call = 0;
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const s = strings.join('');
      if (!s.includes('SELECT') && !s.includes('FROM')) return { strings, values } as unknown as Promise<unknown[]>;
      const result = [entityRows, glossaryRows][call++] ?? [];
      return Promise.resolve(result);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const result = await exportToOSI('ws-1', { includeMetrics: false }, sql);
    const doc = result._unsafeUnwrap();
    const types = doc['@graph'].map(n => n['@type']);
    expect(types).not.toContain('iris:Metric');
    expect(types).toContain('iris:GlossaryTerm');
  });

  it('returns err when SQL throws', async () => {
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const s = strings.join('');
      if (!s.includes('SELECT') && !s.includes('FROM')) return { strings, values } as unknown as Promise<unknown[]>;
      return Promise.reject(new Error('db down'));
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const result = await exportToOSI('ws-1', {}, sql);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('db down');
  });

  it('sets exportedAt to an ISO timestamp', async () => {
    const before = new Date();
    const result = await exportToOSI('ws-1', {}, makeSql());
    const doc = result._unsafeUnwrap();
    const ts = new Date(doc.exportedAt);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('totalNodes matches @graph length', async () => {
    const result = await exportToOSI('ws-1', {}, makeSql());
    const doc = result._unsafeUnwrap();
    expect(doc.totalNodes).toBe(doc['@graph'].length);
  });
});
