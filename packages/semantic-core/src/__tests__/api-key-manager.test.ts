import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const mockSql = Object.assign(vi.fn(), { json: vi.fn() });

const { ApiKeyManager, generateRawKey } = await import('../api-key-manager.js');

function hash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

describe('generateRawKey', () => {
  it('generates a key with the iris_ prefix', () => {
    const key = generateRawKey();
    expect(key.startsWith('iris_')).toBe(true);
  });

  it('generates unique keys each call', () => {
    const keys = new Set(Array.from({ length: 10 }, () => generateRawKey()));
    expect(keys.size).toBe(10);
  });

  it('generates keys of consistent length', () => {
    const key1 = generateRawKey();
    const key2 = generateRawKey();
    expect(key1.length).toBe(key2.length);
    expect(key1.length).toBeGreaterThan(20);
  });
});

describe('ApiKeyManager', () => {
  let manager: InstanceType<typeof ApiKeyManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ApiKeyManager(mockSql as unknown as Parameters<typeof ApiKeyManager>[0]);
  });

  describe('createKey', () => {
    it('inserts a row and returns rawKey + id', async () => {
      mockSql.mockResolvedValueOnce([{ id: 'key-uuid', workspace_id: 'ws-1', display_name: 'prod', created_at: new Date(), last_used_at: null, revoked_at: null }]);

      const result = await manager.createKey('ws-1', 'prod');

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.id).toBe('key-uuid');
      expect(value.rawKey.startsWith('iris_')).toBe(true);
    });

    it('returns error if insert fails', async () => {
      mockSql.mockRejectedValueOnce(new Error('DB down'));

      const result = await manager.createKey('ws-1', 'test');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('validateKey', () => {
    it('returns workspaceId and keyId for a valid key', async () => {
      const rawKey = 'iris_abc123';
      mockSql
        .mockResolvedValueOnce([{ id: 'key-id', workspace_id: 'ws-2', display_name: 'x', created_at: new Date(), last_used_at: null, revoked_at: null }])
        .mockResolvedValueOnce([]);

      const result = await manager.validateKey(rawKey);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.workspaceId).toBe('ws-2');
      expect(value.keyId).toBe('key-id');
    });

    it('returns error when no matching key found', async () => {
      mockSql.mockResolvedValueOnce([]);

      const result = await manager.validateKey('iris_nonexistent');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid or revoked');
    });

    it('returns error when DB throws', async () => {
      mockSql.mockRejectedValueOnce(new Error('timeout'));

      const result = await manager.validateKey('iris_key');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('revokeKey', () => {
    it('runs an UPDATE to set revoked_at', async () => {
      mockSql.mockResolvedValueOnce([]);

      const result = await manager.revokeKey('key-id');
      expect(result.isOk()).toBe(true);
      expect(mockSql).toHaveBeenCalledOnce();
    });

    it('returns error when DB throws', async () => {
      mockSql.mockRejectedValueOnce(new Error('lock timeout'));

      const result = await manager.revokeKey('key-id');
      expect(result.isErr()).toBe(true);
    });
  });
});
