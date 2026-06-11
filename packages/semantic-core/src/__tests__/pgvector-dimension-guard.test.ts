import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgvectorStore } from '../vector-store.js';

// Minimal postgres mock — only the pg_attribute query and the DDL calls matter
function makeSqlMock(atttypmod: number | null) {
  const mockSql = vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?');
    // pg_attribute dimension check
    if (query.includes('pg_attribute')) {
      if (atttypmod === null) {
        // table doesn't exist yet — simulate "relation does not exist" error
        return Promise.reject(Object.assign(new Error('relation "iris_entities" does not exist'), { code: '42P01' }));
      }
      return Promise.resolve(atttypmod === -1 ? [] : [{ atttypmod }]);
    }
    // All other DDL — just succeed
    return Promise.resolve([]);
  });

  // sql.unsafe() for CREATE TABLE with dynamic dimension
  mockSql.unsafe = vi.fn().mockResolvedValue([]);

  return mockSql;
}

// Patch PgvectorStore to inject our mock sql (bypass the constructor's postgres() call)
function makeStore(connectionString: string, dimensions: number, atttypmod: number | null): PgvectorStore {
  const store = new PgvectorStore(connectionString, dimensions);
  const mockSql = makeSqlMock(atttypmod);
  // @ts-expect-error — injecting mock for test
  store.sql = mockSql;
  return store;
}

describe('PgvectorStore dimension guard', () => {
  describe('getDimensions()', () => {
    it('returns 1536 by default', () => {
      const store = new PgvectorStore('postgresql://localhost/test');
      expect(store.getDimensions()).toBe(1536);
    });

    it('returns the provided dimension', () => {
      const store = new PgvectorStore('postgresql://localhost/test', 768);
      expect(store.getDimensions()).toBe(768);
    });
  });

  describe('initialize() dimension mismatch guard', () => {
    it('succeeds when stored dim matches configured dim', async () => {
      const store = makeStore('postgresql://localhost/test', 768, 768);
      await expect(store.initialize()).resolves.toBeUndefined();
    });

    it('succeeds when stored dim is -1 (no constraint)', async () => {
      const store = makeStore('postgresql://localhost/test', 768, -1);
      await expect(store.initialize()).resolves.toBeUndefined();
    });

    it('throws IndexerError when stored dim (1536) differs from configured dim (768)', async () => {
      const store = makeStore('postgresql://localhost/test', 768, 1536);
      await expect(store.initialize()).rejects.toThrow(
        /dimension mismatch.*vector\(1536\).*768/i,
      );
    });

    it('throws IndexerError when stored dim (768) differs from configured dim (1536)', async () => {
      const store = makeStore('postgresql://localhost/test', 1536, 768);
      await expect(store.initialize()).rejects.toThrow(
        /dimension mismatch.*vector\(768\).*1536/i,
      );
    });

    it('proceeds without error when table does not exist yet', async () => {
      // atttypmod=null simulates "relation does not exist" (pg_attribute query rejected)
      const store = makeStore('postgresql://localhost/test', 768, null);
      await expect(store.initialize()).resolves.toBeUndefined();
    });

    it('creates table with the configured dimension (768)', async () => {
      const store = makeStore('postgresql://localhost/test', 768, null);
      await store.initialize();
      // @ts-expect-error — accessing private for assertion
      const unsafeCalls = store.sql.unsafe.mock.calls as unknown[][];
      expect(unsafeCalls.length).toBeGreaterThan(0);
      const ddl = unsafeCalls[0]?.[0] as string;
      expect(ddl).toContain('vector(768)');
    });

    it('creates table with the configured dimension (1536)', async () => {
      const store = makeStore('postgresql://localhost/test', 1536, null);
      await store.initialize();
      // @ts-expect-error — accessing private for assertion
      const unsafeCalls = store.sql.unsafe.mock.calls as unknown[][];
      const ddl = unsafeCalls[0]?.[0] as string;
      expect(ddl).toContain('vector(1536)');
    });
  });
});
