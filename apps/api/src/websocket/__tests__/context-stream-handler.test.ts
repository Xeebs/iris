import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachContextStreamHandler } from '../context-stream-handler.js';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeWs(readyState = 1) {
  const sent: unknown[] = [];
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    readyState,
    OPEN: 1,
    send: vi.fn((msg: string) => sent.push(JSON.parse(msg))),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] ??= [];
      handlers[event]!.push(handler);
    }),
    _sent: sent,
    _emit: (event: string, ...args: unknown[]) => {
      for (const h of handlers[event] ?? []) h(...args);
    },
  };
}

type FakeWs = ReturnType<typeof makeWs>;

function makeReq(workspaceId = 'ws-1', apiKey = 'key-1') {
  return {
    url: `/ws/context?workspaceId=${workspaceId}&apiKey=${encodeURIComponent(apiKey)}`,
    headers: { host: 'localhost' },
  };
}

function makeSql(rowQueues: unknown[][]) {
  const queue = [...rowQueues];
  const mockSql = vi.fn();
  const proxy = new Proxy(mockSql, {
    apply: (_t, _this, args: unknown[]) => {
      const strings = args[0] as string[];
      const s = Array.isArray(strings) ? strings.join('') : '';
      if (!s.includes('SELECT') && !s.includes('INSERT') && !s.includes('UPDATE')) {
        return { strings, values: args.slice(1) };
      }
      return Promise.resolve(queue.shift() ?? []);
    },
  });
  return proxy as unknown as ReturnType<typeof import('postgres').default>;
}

function attachAndConnect(sql: ReturnType<typeof makeSql>, wsId = 'ws-1', key = 'key-1') {
  let connectionHandler: ((ws: FakeWs, req: ReturnType<typeof makeReq>) => void) | undefined;
  const wss = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'connection') connectionHandler = handler as typeof connectionHandler;
    }),
  };
  attachContextStreamHandler(wss as never, sql);

  const ws = makeWs();
  const req = makeReq(wsId, key);
  connectionHandler?.(ws, req);

  const sendMessage = (msg: object) => {
    ws._emit('message', Buffer.from(JSON.stringify(msg)));
  };

  // Allow microtasks to flush
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  return { ws, sendMessage, flush };
}

const ENTITY_ROW = {
  id: 'ent-1',
  entity_type: 'contact',
  label: 'Alice',
  attributes: { email: 'alice@example.com' },
  source_connector_id: 'hubspot',
  last_modified: new Date().toISOString(),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('attachContextStreamHandler', () => {
  describe('connection validation', () => {
    it('closes with 4001 when workspaceId is missing', () => {
      const wss = { on: vi.fn() };
      let handler: ((ws: FakeWs, req: { url: string; headers: Record<string, string> }) => void) | undefined;
      wss.on.mockImplementation((event: string, h: typeof handler) => {
        if (event === 'connection') handler = h;
      });
      attachContextStreamHandler(wss as never, makeSql([[]]));

      const ws = makeWs();
      handler?.(ws, { url: '/ws/context?apiKey=key-1', headers: { host: 'localhost' } });
      expect(ws.close).toHaveBeenCalledWith(4001, expect.stringContaining('Missing'));
    });

    it('closes with 4001 when apiKey is missing', () => {
      const wss = { on: vi.fn() };
      let handler: ((ws: FakeWs, req: { url: string; headers: Record<string, string> }) => void) | undefined;
      wss.on.mockImplementation((event: string, h: typeof handler) => {
        if (event === 'connection') handler = h;
      });
      attachContextStreamHandler(wss as never, makeSql([[]]));

      const ws = makeWs();
      handler?.(ws, { url: '/ws/context?workspaceId=ws-1', headers: { host: 'localhost' } });
      expect(ws.close).toHaveBeenCalledWith(4001, expect.stringContaining('Missing'));
    });

    it('does not close valid connections', () => {
      const { ws } = attachAndConnect(makeSql([[]]));
      expect(ws.close).not.toHaveBeenCalled();
    });
  });

  describe('ping/pong', () => {
    it('replies with pong on ping message', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[]]));
      sendMessage({ type: 'ping' });
      await flush();
      expect(ws._sent.some((m) => (m as { type: string }).type === 'pong')).toBe(true);
    });

    it('pong includes a timestamp', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[]]));
      sendMessage({ type: 'ping' });
      await flush();
      const pong = ws._sent.find((m) => (m as { type: string }).type === 'pong') as {
        data: { ts: number };
      };
      expect(typeof pong.data.ts).toBe('number');
    });
  });

  describe('invalid messages', () => {
    it('sends error for invalid JSON', async () => {
      const { ws, flush } = attachAndConnect(makeSql([[]]));
      ws._emit('message', Buffer.from('{not json'));
      await flush();
      const err = ws._sent.find((m) => (m as { type: string }).type === 'error') as {
        data: { code: string };
      };
      expect(err?.data.code).toBe('PARSE_ERROR');
    });

    it('sends error for unknown message type', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[]]));
      sendMessage({ type: 'unknown' });
      await flush();
      expect(ws._sent.some((m) => (m as { type: string }).type === 'error')).toBe(true);
    });

    it('sends error for subscribe with empty query', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: '' });
      await flush();
      expect(ws._sent.some((m) => (m as { type: string }).type === 'error')).toBe(true);
    });
  });

  describe('subscribe flow', () => {
    it('sends meta then entity then done for a successful query', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[ENTITY_ROW]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'alice', tokenBudget: 4000 });
      await flush();
      await flush();

      const types = ws._sent.map((m) => (m as { type: string }).type);
      expect(types).toContain('meta');
      expect(types).toContain('entity');
      expect(types).toContain('done');
    });

    it('meta message includes query and workspaceId', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[ENTITY_ROW]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'alice', tokenBudget: 4000 });
      await flush();
      await flush();

      const meta = ws._sent.find((m) => (m as { type: string }).type === 'meta') as {
        requestId: string;
        data: { query: string; workspaceId: string };
      };
      expect(meta.requestId).toBe('r1');
      expect(meta.data.query).toBe('alice');
      expect(meta.data.workspaceId).toBe('ws-1');
    });

    it('entity message has correct fields (id, type, label, relevanceScore, confidenceTier)', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[ENTITY_ROW]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'alice', tokenBudget: 4000 });
      await flush();
      await flush();

      const entity = ws._sent.find((m) => (m as { type: string }).type === 'entity') as {
        data: {
          id: string;
          type: string;
          label: string;
          relevanceScore: number;
          confidenceTier: string;
          tokenEstimate: number;
          rank: number;
        };
      };
      expect(entity.data.id).toBe('ent-1');
      expect(entity.data.type).toBe('contact');
      expect(entity.data.label).toBe('Alice');
      expect(typeof entity.data.relevanceScore).toBe('number');
      expect(['high', 'medium', 'low']).toContain(entity.data.confidenceTier);
      expect(typeof entity.data.tokenEstimate).toBe('number');
    });

    it('done message includes entity count, token count, durationMs', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[ENTITY_ROW]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'alice', tokenBudget: 4000 });
      await flush();
      await flush();

      const done = ws._sent.find((m) => (m as { type: string }).type === 'done') as {
        data: { totalEntities: number; totalTokensUsed: number; durationMs: number; truncated: boolean };
      };
      expect(done.data.totalEntities).toBe(1);
      expect(done.data.totalTokensUsed).toBeGreaterThan(0);
      expect(typeof done.data.durationMs).toBe('number');
      expect(done.data.truncated).toBe(false);
    });

    it('returns zero entities and truncated=false when DB returns empty', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'nobody', tokenBudget: 4000 });
      await flush();
      await flush();

      const done = ws._sent.find((m) => (m as { type: string }).type === 'done') as {
        data: { totalEntities: number; truncated: boolean };
      };
      expect(done.data.totalEntities).toBe(0);
      expect(done.data.truncated).toBe(false);
    });
  });

  describe('token budget enforcement', () => {
    it('truncates stream when token budget is exceeded', async () => {
      // Create many rows to exceed a tiny budget
      const rows = Array.from({ length: 10 }, (_, i) => ({
        ...ENTITY_ROW,
        id: `ent-${i}`,
        attributes: { data: 'x'.repeat(400) },
      }));
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([rows]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'test', tokenBudget: 150 });
      await flush();
      await flush();

      const done = ws._sent.find((m) => (m as { type: string }).type === 'done') as {
        data: { truncated: boolean };
      };
      expect(done.data.truncated).toBe(true);
    });

    it('does not send entities beyond token budget', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({
        ...ENTITY_ROW,
        id: `ent-${i}`,
        attributes: { data: 'x'.repeat(800) },
      }));
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([rows]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'test', tokenBudget: 100 });
      await flush();
      await flush();

      const entities = ws._sent.filter((m) => (m as { type: string }).type === 'entity');
      const allTokens = entities.reduce(
        (sum, m) => sum + ((m as { data: { tokenEstimate: number } }).data.tokenEstimate ?? 0),
        0,
      );
      expect(allTokens).toBeLessThanOrEqual(100);
    });
  });

  describe('cancel', () => {
    it('cancels an active stream on cancel message', async () => {
      // Start a subscribe and immediately cancel before the SQL resolves
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[ENTITY_ROW]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'test', tokenBudget: 4000 });
      sendMessage({ type: 'cancel', requestId: 'r1' });
      await flush();
      await flush();
      // No error expected — cancel is clean
      const errors = ws._sent.filter((m) => (m as { type: string }).type === 'error');
      expect(errors.length).toBe(0);
    });
  });

  describe('duplicate requestId', () => {
    it('rejects a second subscribe with the same requestId', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[ENTITY_ROW], [ENTITY_ROW]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'test', tokenBudget: 4000 });
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'test2', tokenBudget: 4000 });
      await flush();
      await flush();

      const errors = ws._sent.filter((m) => (m as { type: string }).type === 'error') as Array<{
        data: { code: string };
      }>;
      expect(errors.some((e) => e.data.code === 'DUPLICATE_REQUEST')).toBe(true);
    });
  });

  describe('confidence tier scoring', () => {
    it('assigns high tier to rank=0 entity (score=1.0)', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[ENTITY_ROW]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'alice', tokenBudget: 4000 });
      await flush();
      await flush();

      const entity = ws._sent.find((m) => (m as { type: string }).type === 'entity') as {
        data: { confidenceTier: string; rank: number };
      };
      expect(entity.data.rank).toBe(0);
      expect(entity.data.confidenceTier).toBe('high');
    });

    it('assigns low tier to rank=20 entity (score≈0)', async () => {
      const rows = Array.from({ length: 21 }, (_, i) => ({ ...ENTITY_ROW, id: `ent-${i}` }));
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([rows]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'test', tokenBudget: 8000 });
      await flush();
      await flush();

      const entities = ws._sent.filter((m) => (m as { type: string }).type === 'entity') as Array<{
        data: { confidenceTier: string; rank: number };
      }>;
      const rank20 = entities.find((e) => e.data.rank === 20);
      expect(rank20?.data.confidenceTier).toBe('low');
    });
  });

  describe('connection cleanup', () => {
    it('aborts all active streams when ws closes', async () => {
      const { sendMessage, flush, ws } = attachAndConnect(makeSql([[ENTITY_ROW]]));
      sendMessage({ type: 'subscribe', requestId: 'r1', query: 'test', tokenBudget: 4000 });
      ws._emit('close');
      await flush();
      await flush();
      // No error thrown — cleanup is silent
      expect(ws.close).not.toHaveBeenCalled();
    });

    it('logs WS errors and cleans up streams', () => {
      const { ws } = attachAndConnect(makeSql([[]]));
      expect(() => ws._emit('error', new Error('network reset'))).not.toThrow();
    });
  });
});
