import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createOsiInterchangeRoutes } from '../routes/osi-interchange.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const validDoc = {
  '@context': { '@vocab': 'https://schema.iris.ai/v1/' },
  '@graph': [
    { '@id': 'ws:contact:1', '@type': 'https://schema.iris.ai/v1/contact', label: 'Alice' },
  ],
  exportedAt: '2026-01-01T00:00:00.000Z',
  workspaceId: 'ws1',
  totalNodes: 1,
};

function makeSql(returnVal: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnVal);
}

function makeApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/api/v1/workspace', createOsiInterchangeRoutes(sql as never));
  return app;
}

describe('POST /api/v1/workspace/import/osi', () => {
  it('returns 200 for a valid OSI document', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/workspace/import/osi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify(validDoc),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { totalNodes: number } };
    expect(body.data.totalNodes).toBe(1);
  });

  it('returns 400 for malformed JSON body', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/workspace/import/osi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for doc missing @graph', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const bad = { ...validDoc, '@graph': undefined };
    const res = await app.request('/api/v1/workspace/import/osi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(bad)),
    });
    expect(res.status).toBe(400);
  });

  it('counts imported entities in summary', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/workspace/import/osi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify(validDoc),
    });
    const body = await res.json() as { data: { imported: { entities: number } } };
    expect(body.data.imported.entities).toBe(1);
  });

  it('returns imported breakdown for mixed node types', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const mixed = {
      ...validDoc,
      '@graph': [
        { '@id': 'e:1', '@type': 'https://schema.iris.ai/v1/contact', label: 'Alice' },
        { '@id': 't:1', '@type': 'https://schema.iris.ai/v1/glossary_term', label: 'ARR', definition: 'ARR' },
        { '@id': 'm:1', '@type': 'https://schema.iris.ai/v1/metric', label: 'MRR', formula: '' },
      ],
      totalNodes: 3,
    };
    const res = await app.request('/api/v1/workspace/import/osi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify(mixed),
    });
    const body = await res.json() as { data: { imported: { entities: number; glossaryTerms: number; metrics: number } } };
    expect(body.data.imported.entities).toBe(1);
    expect(body.data.imported.glossaryTerms).toBe(1);
    expect(body.data.imported.metrics).toBe(1);
  });
});

describe('GET /api/v1/workspace/export/osi/info', () => {
  it('returns OSI format info', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/workspace/export/osi/info');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { version: string; supportedTypes: string[] } };
    expect(body.data.version).toBe('1.0');
    expect(body.data.supportedTypes).toContain('entity');
  });
});
