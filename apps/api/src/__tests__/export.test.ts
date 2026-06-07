import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/osi-exporter', () => ({
  exportToOSI: vi.fn(),
}));

import { exportToOSI } from '@iris/semantic-core/osi-exporter';
import { createExportRoutes } from '../routes/export.js';

const WORKSPACE = 'ws-test';

const FAKE_DOC = {
  '@context': { '@vocab': 'https://schema.iris.ai/v1/' },
  '@graph': [
    { '@id': 'hubspot:contact:1', '@type': 'iris:contact', label: 'Alice' },
  ],
  exportedAt: '2026-06-07T00:00:00.000Z',
  workspaceId: WORKSPACE,
  totalNodes: 1,
};

function makeApp(): Hono {
  const fakeSql = {} as Parameters<typeof createExportRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/export', createExportRoutes(fakeSql));
  return app;
}

describe('GET /api/v1/export/osi', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/export/osi');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with OSI document on success', async () => {
    vi.mocked(exportToOSI).mockResolvedValue(ok(FAKE_DOC));
    const app = makeApp();
    const res = await app.request(`/api/v1/export/osi?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_DOC };
    expect(body.data.workspaceId).toBe(WORKSPACE);
    expect(body.data.totalNodes).toBe(1);
    expect(body.data['@graph']).toHaveLength(1);
  });

  it('returns 500 when exportToOSI fails', async () => {
    vi.mocked(exportToOSI).mockResolvedValue(err(new Error('DB error')));
    const app = makeApp();
    const res = await app.request(`/api/v1/export/osi?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('passes entityTypes filter as array', async () => {
    vi.mocked(exportToOSI).mockResolvedValue(ok(FAKE_DOC));
    const app = makeApp();
    await app.request(`/api/v1/export/osi?workspaceId=${WORKSPACE}&entityTypes=contact,deal`);
    const [, opts] = vi.mocked(exportToOSI).mock.lastCall!;
    expect(opts.entityTypes).toEqual(['contact', 'deal']);
  });

  it('passes since and until as Date objects', async () => {
    vi.mocked(exportToOSI).mockResolvedValue(ok(FAKE_DOC));
    const since = '2026-01-01T00:00:00.000Z';
    const until = '2026-06-01T00:00:00.000Z';
    const app = makeApp();
    await app.request(`/api/v1/export/osi?workspaceId=${WORKSPACE}&since=${since}&until=${until}`);
    const [, opts] = vi.mocked(exportToOSI).mock.lastCall!;
    expect(opts.since).toEqual(new Date(since));
    expect(opts.until).toEqual(new Date(until));
  });

  it('disables glossary when includeGlossary=false', async () => {
    vi.mocked(exportToOSI).mockResolvedValue(ok(FAKE_DOC));
    const app = makeApp();
    await app.request(`/api/v1/export/osi?workspaceId=${WORKSPACE}&includeGlossary=false`);
    const [, opts] = vi.mocked(exportToOSI).mock.lastCall!;
    expect(opts.includeGlossary).toBe(false);
  });

  it('disables metrics when includeMetrics=false', async () => {
    vi.mocked(exportToOSI).mockResolvedValue(ok(FAKE_DOC));
    const app = makeApp();
    await app.request(`/api/v1/export/osi?workspaceId=${WORKSPACE}&includeMetrics=false`);
    const [, opts] = vi.mocked(exportToOSI).mock.lastCall!;
    expect(opts.includeMetrics).toBe(false);
  });

  it('includes glossary and metrics by default', async () => {
    vi.mocked(exportToOSI).mockResolvedValue(ok(FAKE_DOC));
    const app = makeApp();
    await app.request(`/api/v1/export/osi?workspaceId=${WORKSPACE}`);
    const [, opts] = vi.mocked(exportToOSI).mock.lastCall!;
    expect(opts.includeGlossary).toBe(true);
    expect(opts.includeMetrics).toBe(true);
  });
});
