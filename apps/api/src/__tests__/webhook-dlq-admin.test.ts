import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeWebhookDlqRouter } from '../routes/webhook-dlq-admin.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/webhook-reliability', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/webhook-reliability')>(
    '@iris/semantic-core/webhook-reliability',
  );
  return { ...actual, WebhookReliabilityManager: vi.fn() };
});

import { WebhookReliabilityManager } from '@iris/semantic-core/webhook-reliability';

const mockManager = {
  listDlq: vi.fn(),
  markReplayed: vi.fn(),
  analyzePatterns: vi.fn(),
  pruneOldEvents: vi.fn(),
};

function makeApp() {
  (WebhookReliabilityManager as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockManager);
  const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
  return makeWebhookDlqRouter(sql);
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-workspace-id': 'ws1', 'content-type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('GET /dlq', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns DLQ events', async () => {
    const { ok } = await import('neverthrow');
    mockManager.listDlq.mockResolvedValue(ok({ events: [], nextCursor: null }));
    const app = makeApp();
    const res = await app.fetch(req('/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.meta.hasMore).toBe(false);
  });
});

describe('POST /dlq/:id/replay', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks event as replayed', async () => {
    const { ok } = await import('neverthrow');
    mockManager.markReplayed.mockResolvedValue(ok(true));
    const app = makeApp();
    const res = await app.fetch(req('/ev-1/replay', { method: 'POST', body: JSON.stringify({ replayedBy: 'admin' }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.replayed).toBe(true);
  });

  it('returns 404 when event not found', async () => {
    const { ok } = await import('neverthrow');
    mockManager.markReplayed.mockResolvedValue(ok(false));
    const app = makeApp();
    const res = await app.fetch(req('/ev-missing/replay', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(404);
  });
});

describe('GET /dlq/analyze', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns pattern analysis', async () => {
    const { ok } = await import('neverthrow');
    const patterns = [{ pattern: 'endpoint_unreachable', count: 5, affectedEndpoints: ['https://ep1.com'], suggestion: 'check network' }];
    mockManager.analyzePatterns.mockResolvedValue(ok(patterns));
    const app = makeApp();
    const res = await app.fetch(req('/analyze'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].pattern).toBe('endpoint_unreachable');
  });
});
