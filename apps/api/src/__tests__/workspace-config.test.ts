import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/nlp-config-parser', () => ({
  parseConfigNL: vi.fn(),
  NlpConfigService: vi.fn(),
}));

import { parseConfigNL, NlpConfigService } from '@iris/semantic-core/nlp-config-parser';
import { createWorkspaceConfigRoutes } from '../routes/workspace-config.js';

const WORKSPACE = 'ws-test';

const FAKE_PARSED = {
  configType: 'fiscal_calendar' as const,
  parsedJson: { fiscalYearStartMonth: 2 },
  summary: 'Fiscal year starts February 1st',
  confidence: 0.95,
};

const FAKE_RECORD = {
  id: 'cfg-1',
  workspaceId: WORKSPACE,
  configType: 'fiscal_calendar' as const,
  inputText: 'Our fiscal year starts in February',
  parsedJson: { fiscalYearStartMonth: 2 },
  status: 'pending' as const,
  approvedBy: null,
  approvedAt: null,
  interpretedAt: new Date(),
  createdAt: new Date(),
};

function makeApp(methods: Partial<InstanceType<typeof NlpConfigService>>) {
  vi.mocked(NlpConfigService).mockImplementation(() => methods as InstanceType<typeof NlpConfigService>);
  const fakeSql = {} as Parameters<typeof createWorkspaceConfigRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/workspace', createWorkspaceConfigRoutes(fakeSql));
  return app;
}

describe('POST /api/v1/workspace/config-from-language', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 on invalid body', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/config-from-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when parseConfigNL fails', async () => {
    vi.mocked(parseConfigNL).mockResolvedValue(err(new Error('API down')));
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/config-from-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, text: 'test', openAiKey: 'sk-test' }),
    });
    expect(res.status).toBe(500);
  });

  it('returns 200 with parsed result when save=false', async () => {
    vi.mocked(parseConfigNL).mockResolvedValue(ok(FAKE_PARSED));
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/config-from-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, text: 'fiscal year starts in February', openAiKey: 'sk-test', save: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { parsed: typeof FAKE_PARSED } };
    expect(body.data.parsed.configType).toBe('fiscal_calendar');
  });

  it('returns 201 with saved record when save=true', async () => {
    vi.mocked(parseConfigNL).mockResolvedValue(ok(FAKE_PARSED));
    const saveConfig = vi.fn().mockResolvedValue(ok(FAKE_RECORD));
    const app = makeApp({ saveConfig });
    const res = await app.request('/api/v1/workspace/config-from-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, text: 'fiscal year starts in February', openAiKey: 'sk-test', save: true }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { record: { id: string } } };
    expect(body.data.record.id).toBe('cfg-1');
  });
});

describe('GET /api/v1/workspace/nlp-configs', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/nlp-configs');
    expect(res.status).toBe(400);
  });

  it('returns 200 with config list', async () => {
    const listConfigs = vi.fn().mockResolvedValue(ok([FAKE_RECORD]));
    const app = makeApp({ listConfigs });
    const res = await app.request(`/api/v1/workspace/nlp-configs?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_RECORD[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe('cfg-1');
  });

  it('returns 500 on service error', async () => {
    const listConfigs = vi.fn().mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp({ listConfigs });
    const res = await app.request(`/api/v1/workspace/nlp-configs?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/v1/workspace/nlp-configs/:id/approve', () => {
  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/nlp-configs/cfg-1/approve', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'user-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when config not found', async () => {
    const approveConfig = vi.fn().mockResolvedValue(ok(null));
    const app = makeApp({ approveConfig });
    const res = await app.request(`/api/v1/workspace/nlp-configs/missing/approve?workspaceId=${WORKSPACE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'user-1' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful approval', async () => {
    const approved = { ...FAKE_RECORD, status: 'approved' as const };
    const approveConfig = vi.fn().mockResolvedValue(ok(approved));
    const app = makeApp({ approveConfig });
    const res = await app.request(`/api/v1/workspace/nlp-configs/cfg-1/approve?workspaceId=${WORKSPACE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'user-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('approved');
  });
});
