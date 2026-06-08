import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  applyMaskPreview,
} from '../pii-masking-audit.js';

describe('encodeCursor / decodeCursor', () => {
  it('encodes and decodes round-trip', () => {
    const date = new Date('2026-01-15T10:00:00.000Z');
    const id = 'abc-123';
    const cursor = encodeCursor(date, id);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.t).toBe(date.toISOString());
    expect(decoded!.id).toBe(id);
  });

  it('returns null for an invalid cursor', () => {
    expect(decodeCursor('not-base64-at-all!!')).toBeNull();
  });

  it('produces a URL-safe string (no + or /)', () => {
    const cursor = encodeCursor(new Date(), 'uuid-1234');
    expect(cursor).not.toContain('+');
    expect(cursor).not.toContain('/');
  });
});

describe('applyMaskPreview', () => {
  const email = 'alice@example.com';

  it('redact strategy returns [REDACTED]', () => {
    expect(applyMaskPreview(email, 'redact')).toBe('[REDACTED]');
  });

  it('hash strategy returns deterministic hash prefix', () => {
    const a = applyMaskPreview(email, 'hash');
    const b = applyMaskPreview(email, 'hash');
    expect(a).toBe(b);
    expect(a).toMatch(/^\[hash:[0-9a-f]+\]$/);
  });

  it('tokenize strategy returns token prefix', () => {
    const t = applyMaskPreview(email, 'tokenize');
    expect(t).toMatch(/^\[token:[0-9a-f]+\]$/);
  });

  it('keep_last_4 shows last 4 chars', () => {
    expect(applyMaskPreview('4111111111111234', 'keep_last_4')).toBe('****1234');
  });

  it('keep_last_4 masks short values entirely', () => {
    expect(applyMaskPreview('abc', 'keep_last_4')).toBe('****');
  });

  it('none strategy returns original value', () => {
    expect(applyMaskPreview(email, 'none')).toBe(email);
  });

  it('hash is different for different inputs', () => {
    const a = applyMaskPreview('alice@example.com', 'hash');
    const b = applyMaskPreview('bob@example.com', 'hash');
    expect(a).not.toBe(b);
  });
});
