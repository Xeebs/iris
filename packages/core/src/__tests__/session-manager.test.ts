import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../session-manager.js';

vi.mock('../logger.js', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const SESSION_ROW = {
  id: 'sess-1',
  workspace_id: 'ws-1',
  user_id: 'user-1',
  device_id: null,
  ip_address: '1.2.3.4',
  user_agent: 'Mozilla/5.0',
  browser_name: 'Chrome',
  os_name: 'macOS',
  country_code: 'US',
  is_active: true,
  created_at: '2026-06-07T00:00:00Z',
  last_activity_at: '2026-06-07T01:00:00Z',
  expires_at: '2026-07-07T00:00:00Z',
  revoked_at: null,
};

const DEVICE_ROW = {
  id: 'dev-1',
  user_id: 'user-1',
  workspace_id: 'ws-1',
  device_name: 'MacBook Pro',
  fingerprint: 'abc123',
  trusted_at: '2026-06-07T00:00:00Z',
  last_used_at: '2026-06-07T00:00:00Z',
};

function makeService(sql: ReturnType<typeof vi.fn>) {
  return new SessionManager(sql as unknown as ConstructorParameters<typeof SessionManager>[0]);
}

describe('SessionManager', () => {
  let sql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('creates a session when under the concurrent limit', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [{ cnt: 2 }]; // count check — under limit, no revoke
        return [SESSION_ROW]; // INSERT (call 2)
      });
      const svc = makeService(sql);
      // no deviceFingerprint → device query is skipped entirely
      const result = await svc.createSession({ userId: 'user-1', workspaceId: 'ws-1', ipAddress: '1.2.3.4' });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().userId).toBe('user-1');
    });

    it('revokes oldest session when at MAX_SESSIONS_PER_USER (5)', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [{ cnt: 5 }]; // at limit
        if (call === 2) return []; // revoke oldest
        return [SESSION_ROW]; // INSERT (call 3, no fingerprint → no device query)
      });
      const svc = makeService(sql);
      const result = await svc.createSession({ userId: 'user-1', workspaceId: 'ws-1' });
      expect(result.isOk()).toBe(true);
      expect(call).toBe(3);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error'));
      const svc = makeService(sql);
      const result = await svc.createSession({ userId: 'user-1', workspaceId: 'ws-1' });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('refreshSession', () => {
    it('refreshes an active session', async () => {
      sql = vi.fn(async () => [SESSION_ROW]);
      const svc = makeService(sql);
      const result = await svc.refreshSession('sess-1');
      expect(result.isOk()).toBe(true);
    });

    it('returns err when session not found', async () => {
      sql = vi.fn(async () => []);
      const svc = makeService(sql);
      const result = await svc.refreshSession('missing');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');
    });
  });

  describe('revokeSession', () => {
    it('revokes a session and returns ok', async () => {
      sql = vi.fn(async () => []);
      const svc = makeService(sql);
      const result = await svc.revokeSession('sess-1');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('getActiveSessions', () => {
    it('returns active sessions for user', async () => {
      sql = vi.fn(async () => [SESSION_ROW, { ...SESSION_ROW, id: 'sess-2' }]);
      const svc = makeService(sql);
      const result = await svc.getActiveSessions('user-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });
  });

  describe('trustDevice', () => {
    it('upserts a trusted device', async () => {
      sql = vi.fn(async () => [DEVICE_ROW]);
      const svc = makeService(sql);
      const result = await svc.trustDevice('user-1', 'ws-1', 'abc123', 'MacBook Pro');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().fingerprint).toBe('abc123');
    });
  });

  describe('getTrustedDevices', () => {
    it('returns trusted devices', async () => {
      sql = vi.fn(async () => [DEVICE_ROW]);
      const svc = makeService(sql);
      const result = await svc.getTrustedDevices('user-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()[0]!.id).toBe('dev-1');
    });
  });

  describe('revokeDevice', () => {
    it('deletes device and returns ok', async () => {
      sql = vi.fn(async () => []);
      const svc = makeService(sql);
      const result = await svc.revokeDevice('dev-1', 'user-1');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('isNewCountry', () => {
    it('returns true when no prior sessions from that country', async () => {
      sql = vi.fn(async () => []); // no rows = new country
      const svc = makeService(sql);
      const result = await svc.isNewCountry('user-1', 'ws-1', 'DE');
      expect(result).toBe(true);
    });

    it('returns false when prior sessions exist from that country', async () => {
      sql = vi.fn(async () => [{ cnt: 1 }]);
      const svc = makeService(sql);
      const result = await svc.isNewCountry('user-1', 'ws-1', 'US');
      expect(result).toBe(false);
    });
  });

  describe('expireInactiveSessions', () => {
    it('completes without throwing (non-fatal)', async () => {
      sql = vi.fn(async () => [{ id: 'sess-1' }, { id: 'sess-2' }]);
      const svc = makeService(sql);
      await expect(svc.expireInactiveSessions()).resolves.toBeUndefined();
    });
  });
});
