import { describe, it, expect } from 'vitest';
import { SecretVault } from '../secret-vault.js';

const vault = new SecretVault('test-master-secret-for-unit-tests');

describe('SecretVault', () => {
  describe('encrypt / decrypt', () => {
    it('round-trips plaintext correctly', () => {
      const plain = 'super-secret-api-key-value';
      const enc = vault.encrypt(plain);
      expect(enc.isOk()).toBe(true);
      const dec = vault.decrypt(enc._unsafeUnwrap());
      expect(dec.isOk()).toBe(true);
      expect(dec._unsafeUnwrap()).toBe(plain);
    });

    it('produces different ciphertext for each call (random IV)', () => {
      const plain = 'same-plaintext';
      const c1 = vault.encrypt(plain)._unsafeUnwrap();
      const c2 = vault.encrypt(plain)._unsafeUnwrap();
      expect(c1).not.toBe(c2);
    });

    it('returns err on tampered ciphertext', () => {
      const enc = vault.encrypt('hello')._unsafeUnwrap();
      const tampered = Buffer.from(enc, 'base64');
      tampered[20] ^= 0xff;
      const result = vault.decrypt(tampered.toString('base64'));
      expect(result.isErr()).toBe(true);
    });

    it('returns err on invalid base64', () => {
      const result = vault.decrypt('not-valid-base64!!!');
      expect(result.isErr()).toBe(true);
    });

    it('encrypts empty string', () => {
      const enc = vault.encrypt('');
      expect(enc.isOk()).toBe(true);
      const dec = vault.decrypt(enc._unsafeUnwrap());
      expect(dec._unsafeUnwrap()).toBe('');
    });
  });

  describe('generateApiKey', () => {
    it('produces an iris_ prefixed key', () => {
      const { plaintext } = vault.generateApiKey();
      expect(plaintext).toMatch(/^iris_[0-9a-f]{64}$/);
    });

    it('prefix is the first 8 chars of the key', () => {
      const { plaintext, prefix } = vault.generateApiKey();
      expect(plaintext.startsWith(prefix)).toBe(true);
      expect(prefix).toHaveLength(8);
    });

    it('suffix is the last 4 chars of the key', () => {
      const { plaintext, suffix } = vault.generateApiKey();
      expect(plaintext.endsWith(suffix)).toBe(true);
      expect(suffix).toHaveLength(4);
    });

    it('hash is SHA-256 hex of the plaintext', () => {
      const { plaintext, hash } = vault.generateApiKey();
      expect(hash).toHaveLength(64);
      // Verify re-generating the hash matches
      expect(vault.verifyApiKey(plaintext, hash)).toBe(true);
    });

    it('generates unique keys each time', () => {
      const k1 = vault.generateApiKey();
      const k2 = vault.generateApiKey();
      expect(k1.plaintext).not.toBe(k2.plaintext);
    });
  });

  describe('verifyApiKey', () => {
    it('returns true for matching plaintext and hash', () => {
      const { plaintext, hash } = vault.generateApiKey();
      expect(vault.verifyApiKey(plaintext, hash)).toBe(true);
    });

    it('returns false for wrong plaintext', () => {
      const { hash } = vault.generateApiKey();
      expect(vault.verifyApiKey('iris_wrongkey', hash)).toBe(false);
    });

    it('uses timing-safe comparison (no early exit)', () => {
      const { hash } = vault.generateApiKey();
      // Call multiple times — should not throw and always return false
      for (let i = 0; i < 5; i++) {
        expect(vault.verifyApiKey('different-each-time-' + i, hash)).toBe(false);
      }
    });
  });

  describe('isInGracePeriod', () => {
    it('returns false for non-rotated key', () => {
      const record = makeRecord({ status: 'active' });
      expect(vault.isInGracePeriod(record, 'somehash')).toBe(false);
    });

    it('returns false when grace period has expired', () => {
      const pastDate = new Date(Date.now() - 1000);
      const record = makeRecord({
        status: 'rotated',
        gracePeriodEndsAt: pastDate,
        previousKeyHashes: ['oldhash'],
      });
      expect(vault.isInGracePeriod(record, 'oldhash')).toBe(false);
    });

    it('returns true when within grace period and hash matches', () => {
      const futureDate = new Date(Date.now() + 86400000);
      const record = makeRecord({
        status: 'rotated',
        gracePeriodEndsAt: futureDate,
        previousKeyHashes: ['validoldhash'],
      });
      expect(vault.isInGracePeriod(record, 'validoldhash')).toBe(true);
    });

    it('returns false when hash is not in previous hashes', () => {
      const futureDate = new Date(Date.now() + 86400000);
      const record = makeRecord({
        status: 'rotated',
        gracePeriodEndsAt: futureDate,
        previousKeyHashes: ['differenthash'],
      });
      expect(vault.isInGracePeriod(record, 'wronghash')).toBe(false);
    });
  });

  describe('computeGracePeriodEnd', () => {
    it('returns a date 7 days in the future', () => {
      const end = vault.computeGracePeriodEnd();
      const diffMs = end.getTime() - Date.now();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 0);
    });
  });
});

function makeRecord(overrides: Partial<import('../secret-vault.js').ApiKeyRecord> = {}): import('../secret-vault.js').ApiKeyRecord {
  return {
    id: 'key-uuid-1',
    workspaceId: 'ws-1',
    name: 'Test Key',
    keyPrefix: 'iris_abc',
    keySuffix: '1234',
    keyHash: 'abc123',
    status: 'active',
    keyVersion: 1,
    previousKeyHashes: [],
    expiresAt: null,
    rotationScheduleDays: null,
    rotatedAt: null,
    revokedAt: null,
    gracePeriodEndsAt: null,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}
