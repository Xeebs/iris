import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/session-manager', () => ({
  SessionManager: vi.fn(),
}));
vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { SessionManager } from '@iris/core/session-manager';
import { createSessionRoutes } from '../routes/sessions.js';

const SESSION = {
  id: 'sess-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  deviceId: null,
  ipAddress: '1.2.3.4',
  userAgent: 'Mozilla/5.0',
  browserName: 'Chrome',
  osName: 'Linux',
  countryCode: 'US',
  isActive: true,
  createdAt: new Date('2026-01-01'),
  lastActivityAt: new Date('2026-01-01'),
  expiresAt: new Date('2026-02-01'),
  revokedAt: null,
};

const DEVICE = {
  id: 'dev-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  deviceName: 'My Laptop',
  fingerprint: 'fp-abc',
  trustedAt: new Date('2026-01-01'),
  lastUsedAt: new Date('2026-01-01'),
};

function okResult<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value, error: null };
}
function errResult(msg: string) {
  const e = new Error(msg);
  return { isOk: () => false, isErr: () => true, value: undefined, error: e };
}

let mockManager: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockManager = {
    getActiveSessions: vi.fn().mockResolvedValue(okResult([SESSION])),
    createSession: vi.fn().mockResolvedValue(okResult(SESSION)),
    refreshSession: vi.fn().mockResolvedValue(okResult(SESSION)),
    revokeSession: vi.fn().mockResolvedValue(okResult(undefined)),
    getTrustedDevices: vi.fn().mockResolvedValue(okResult([DEVICE])),
    trustDevice: vi.fn().mockResolvedValue(okResult(DEVICE)),
    revokeDevice: vi.fn().mockResolvedValue(okResult(undefined)),
    isNewCountry: vi.fn().mockResolvedValue(false),
  };
  vi.mocked(SessionManager).mockImplementation(() => mockManager as never);
});

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-1'); await next(); });
  app.route('/sessions', createSessionRoutes({} as never));
  return app;
}

describe('GET /sessions', () => {
  it('returns active sessions for user', async () => {
    const res = await makeApp().request('/sessions?userId=user-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof SESSION[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe('sess-1');
  });

  it('returns 400 when userId missing', async () => {
    const res = await makeApp().request('/sessions');
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    mockManager.getActiveSessions!.mockResolvedValue(errResult('db error'));
    const res = await makeApp().request('/sessions?userId=user-1');
    expect(res.status).toBe(500);
  });
});

describe('POST /sessions', () => {
  it('creates a session and returns 201', async () => {
    const res = await makeApp().request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', ipAddress: '1.2.3.4', countryCode: 'US' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof SESSION };
    expect(body.data.id).toBe('sess-1');
  });

  it('returns 400 for invalid body', async () => {
    const res = await makeApp().request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    mockManager.createSession!.mockResolvedValue(errResult('db error'));
    const res = await makeApp().request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /sessions/:id/refresh', () => {
  it('refreshes a session', async () => {
    const res = await makeApp().request('/sessions/sess-1/refresh', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('returns 404 when session not found', async () => {
    mockManager.refreshSession!.mockResolvedValue(errResult('Session not found'));
    const res = await makeApp().request('/sessions/missing/refresh', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /sessions/:id', () => {
  it('revokes a session', async () => {
    const res = await makeApp().request('/sessions/sess-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { revoked: boolean } };
    expect(body.data.revoked).toBe(true);
  });
});

describe('GET /sessions/devices', () => {
  it('returns trusted devices', async () => {
    const res = await makeApp().request('/sessions/devices?userId=user-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof DEVICE[] };
    expect(body.data[0]!.fingerprint).toBe('fp-abc');
  });
});

describe('POST /sessions/devices', () => {
  it('trusts a device', async () => {
    const res = await makeApp().request('/sessions/devices?userId=user-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint: 'fp-abc', deviceName: 'My Laptop' }),
    });
    expect(res.status).toBe(201);
  });
});

describe('DELETE /sessions/devices/:deviceId', () => {
  it('revokes device trust', async () => {
    const res = await makeApp().request('/sessions/devices/dev-1?userId=user-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { revoked: boolean } };
    expect(body.data.revoked).toBe(true);
  });
});
