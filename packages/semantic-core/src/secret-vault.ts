import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash, timingSafeEqual } from 'crypto';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/** Grace period after key rotation before the old key is invalid. */
const ROTATION_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApiKeyRecord = {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  keySuffix: string;
  keyHash: string;
  status: 'active' | 'rotated' | 'revoked' | 'expired';
  keyVersion: number;
  previousKeyHashes: string[];
  expiresAt: Date | null;
  rotationScheduleDays: number | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  gracePeriodEndsAt: Date | null;
  createdAt: Date;
};

export type ApiKeyCreateResult = {
  record: ApiKeyRecord;
  plaintextKey: string;
};

export type ApiKeyRotateResult = {
  record: ApiKeyRecord;
  newPlaintextKey: string;
  gracePeriodEndsAt: Date;
};

// ─── SecretVault ──────────────────────────────────────────────────────────────

/**
 * Handles AES-256-GCM encryption/decryption for sensitive secrets,
 * and manages the full API key lifecycle (creation, rotation, revocation).
 */
export class SecretVault {
  private readonly encryptionKey: Buffer;

  /**
   * @param masterSecret - Master secret (from env var) used to derive the encryption key
   */
  constructor(masterSecret: string) {
    const salt = Buffer.alloc(SALT_LENGTH, 'iris-secret-vault');
    this.encryptionKey = scryptSync(masterSecret, salt, KEY_LENGTH);
  }

  /**
   * Encrypt plaintext using AES-256-GCM. Returns base64-encoded ciphertext.
   *
   * @param plaintext - Value to encrypt
   */
  encrypt(plaintext: string): Result<string, Error> {
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const combined = Buffer.concat([iv, tag, encrypted]);
      return ok(combined.toString('base64'));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Decrypt a base64-encoded ciphertext produced by `encrypt`.
   *
   * @param ciphertext - Base64 ciphertext
   */
  decrypt(ciphertext: string): Result<string, Error> {
    try {
      const combined = Buffer.from(ciphertext, 'base64');
      const iv = combined.subarray(0, IV_LENGTH);
      const tag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return ok(decrypted.toString('utf8'));
    } catch (e) {
      return err(e instanceof Error ? e : new Error('Decryption failed'));
    }
  }

  /**
   * Generate a new API key (format: `iris_<random32bytes_hex>`).
   * Returns the plaintext key, masked prefix/suffix, and SHA-256 hash.
   */
  generateApiKey(): { plaintext: string; prefix: string; suffix: string; hash: string } {
    const raw = `iris_${randomBytes(32).toString('hex')}`;
    const hash = createHash('sha256').update(raw).digest('hex');
    return {
      plaintext: raw,
      prefix: raw.slice(0, 8),
      suffix: raw.slice(-4),
      hash,
    };
  }

  /**
   * Verify that a provided plaintext key matches a stored hash using timing-safe comparison.
   *
   * @param plaintext - Key provided by the caller
   * @param storedHash - SHA-256 hash from the database
   */
  verifyApiKey(plaintext: string, storedHash: string): boolean {
    const hash = createHash('sha256').update(plaintext).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Check if an API key is within its rotation grace period (old key still valid).
   *
   * @param record - The rotated key record
   * @param providedHash - Hash of the key being validated
   */
  isInGracePeriod(record: ApiKeyRecord, providedHash: string): boolean {
    if (record.status !== 'rotated') return false;
    if (!record.gracePeriodEndsAt || record.gracePeriodEndsAt < new Date()) return false;
    return record.previousKeyHashes.includes(providedHash);
  }

  /**
   * Compute the grace period end date for a rotated key.
   */
  computeGracePeriodEnd(): Date {
    return new Date(Date.now() + ROTATION_GRACE_PERIOD_MS);
  }
}
