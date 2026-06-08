import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/nlp-config-engine', () => ({
  NlpConfigEngine: vi.fn().mockImplementation(() => mockEngine),
  parseConfigIntent: vi.fn(),
  generateConfigDiff: vi.fn(),
}));

const mockEngine = {
  parseAndSave: vi.fn(),
  listPending: vi.fn(),
  applyIntent: vi.fn(),
  dismissIntent: vi.fn(),
};

import { parseConfigIntent, generateConfigDiff } from '@iris/semantic-core/nlp-config-engine';
import { createNlpConfigRoutes } from '../routes/nlp-config.js';

const WORKSPACE = 'ws-nlp-test';

function makeApp(): Hono {
  const app = new Hono();
  app.route('/api/v1/nlp-config', createNlpConfigRoutes({} as Parameters<typeof createNlpConfigRoutes>[0]));
  return app;
}

const FAKE_INTENT = {
  id: 'intent-1',
  workspaceId: WORKSPACE,
  category: 'temporal',
  naturalText: 'Our fiscal year starts in February',
  interpretedConfigJson: { fiscalYearStartMonth: 2, fiscalYearStartDay: 1 },
  confirmedByUserId: null,
  appliedAt: null,
  createdAt: new Date().toISOString(),
};

describe('POST /api/v1/nlp-config/parse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without workspace header', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'fiscal year starts in Feb' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when text is missing', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 422 when intent cannot be parsed', async () => {
    const { err } = await import('neverthrow');
    vi.mocked(parseConfigIntent).mockReturnValue(err(new Error('Could not parse intent')));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE },
      body: JSON.stringify({ text: 'gibberish that makes no sense' }),
    });
    expect(res.status).toBe(422);
  });

  it('returns 200 with parsed intent and diff', async () => {
    const { ok } = await import('neverthrow');
    const intent = { category: 'temporal', payload: { fiscalYearStartMonth: 2 }, summary: 'Fiscal year starts Feb', confidence: 0.95, rawInput: 'fiscal year in Feb' };
    const diff = { category: 'temporal', before: null, after: { fiscalYearStartMonth: 2 }, explanation: 'Updates workspace temporal settings.' };
    vi.mocked(parseConfigIntent).mockReturnValue(ok(intent));
    vi.mocked(generateConfigDiff).mockReturnValue(diff);
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE },
      body: JSON.stringify({ text: 'fiscal year in Feb' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { intent: typeof intent; diff: typeof diff } };
    expect(body.data.intent.category).toBe('temporal');
    expect(body.data.diff.explanation).toContain('temporal');
  });
});

describe('POST /api/v1/nlp-config/intents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without workspace header', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'fiscal year in Feb' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 422 on unrecognized intent', async () => {
    const { err } = await import('neverthrow');
    mockEngine.parseAndSave.mockResolvedValue(err(new Error('Could not parse intent from: "xyz"')));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE },
      body: JSON.stringify({ text: 'xyz' }),
    });
    expect(res.status).toBe(422);
  });

  it('returns 201 with saved intent', async () => {
    const { ok } = await import('neverthrow');
    mockEngine.parseAndSave.mockResolvedValue(ok(FAKE_INTENT));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE },
      body: JSON.stringify({ text: 'Our fiscal year starts in February' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof FAKE_INTENT };
    expect(body.data.category).toBe('temporal');
  });
});

describe('GET /api/v1/nlp-config/intents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without workspace header', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents');
    expect(res.status).toBe(401);
  });

  it('returns 200 with pending intents list', async () => {
    const { ok } = await import('neverthrow');
    mockEngine.listPending.mockResolvedValue(ok([FAKE_INTENT]));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents', { headers: { 'x-workspace-id': WORKSPACE } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_INTENT[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.category).toBe('temporal');
  });

  it('returns 500 on service error', async () => {
    const { err } = await import('neverthrow');
    mockEngine.listPending.mockResolvedValue(err(new Error('DB error')));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents', { headers: { 'x-workspace-id': WORKSPACE } });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/nlp-config/intents/:id/apply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without workspace header', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents/intent-1/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when userId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents/intent-1/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when intent not found', async () => {
    const { ok } = await import('neverthrow');
    mockEngine.applyIntent.mockResolvedValue(ok(null));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents/nonexistent/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful apply', async () => {
    const { ok } = await import('neverthrow');
    const applied = { ...FAKE_INTENT, confirmedByUserId: 'user-1', appliedAt: new Date().toISOString() };
    mockEngine.applyIntent.mockResolvedValue(ok(applied));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents/intent-1/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof applied };
    expect(body.data.confirmedByUserId).toBe('user-1');
  });
});

describe('DELETE /api/v1/nlp-config/intents/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without workspace header', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents/intent-1', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('returns 404 when intent not found', async () => {
    const { ok } = await import('neverthrow');
    mockEngine.dismissIntent.mockResolvedValue(ok(false));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents/nonexistent', {
      method: 'DELETE',
      headers: { 'x-workspace-id': WORKSPACE },
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful dismiss', async () => {
    const { ok } = await import('neverthrow');
    mockEngine.dismissIntent.mockResolvedValue(ok(true));
    const app = makeApp();
    const res = await app.request('/api/v1/nlp-config/intents/intent-1', {
      method: 'DELETE',
      headers: { 'x-workspace-id': WORKSPACE },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { dismissed: boolean } };
    expect(body.data.dismissed).toBe(true);
  });
});
