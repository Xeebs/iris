import { describe, it, expect } from 'vitest';

import { normalizeRelationships, normalizeAttributes } from '../vector-store.js';

describe('normalizeRelationships', () => {
  it('passes through a well-formed array', () => {
    const rels = [{ type: 'belongs_to', targetId: 'hubspot:company:1' }];
    expect(normalizeRelationships(rels)).toEqual(rels);
  });

  it('parses a JSON-string value (double-encoded JSONB regression)', () => {
    const rels = [{ type: 'belongs_to', targetId: 'hubspot:company:1' }];
    expect(normalizeRelationships(JSON.stringify(rels))).toEqual(rels);
  });

  it('parses a JSON-string empty array', () => {
    expect(normalizeRelationships('[]')).toEqual([]);
  });

  it('returns empty array for a non-JSON string', () => {
    expect(normalizeRelationships('not json at all')).toEqual([]);
  });

  it('returns empty array for null, undefined, and objects', () => {
    expect(normalizeRelationships(null)).toEqual([]);
    expect(normalizeRelationships(undefined)).toEqual([]);
    expect(normalizeRelationships({ type: 'belongs_to', targetId: 'x' })).toEqual([]);
  });

  it('drops entries without string type/targetId', () => {
    const input = [
      { type: 'belongs_to', targetId: 'hubspot:company:1' },
      { type: 'belongs_to' },
      { targetId: 'hubspot:company:2' },
      null,
      'garbage',
      { type: 42, targetId: 'hubspot:company:3' },
    ];
    expect(normalizeRelationships(input)).toEqual([
      { type: 'belongs_to', targetId: 'hubspot:company:1' },
    ]);
  });
});

describe('normalizeAttributes', () => {
  it('passes through a plain object', () => {
    const attrs = { email: 'a@b.com', amount: 120000 };
    expect(normalizeAttributes(attrs)).toEqual(attrs);
  });

  it('parses a JSON-string value (double-encoded JSONB regression)', () => {
    const attrs = { email: 'a@b.com', amount: 120000 };
    expect(normalizeAttributes(JSON.stringify(attrs))).toEqual(attrs);
  });

  it('returns empty object for non-JSON strings, null, and arrays', () => {
    expect(normalizeAttributes('not json')).toEqual({});
    expect(normalizeAttributes(null)).toEqual({});
    expect(normalizeAttributes(['a', 'b'])).toEqual({});
  });
});
