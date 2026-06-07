import { describe, it, expect, vi } from 'vitest';
import {
  discoverJsonSchema,
  discoverCsvSchema,
  discoverSchema,
  SchemaDiscovererService,
} from '../schema-discoverer.js';
import type { SchemaFieldDecision } from '../schema-discoverer.js';

// ─── discoverJsonSchema ───────────────────────────────────────────────────────

describe('discoverJsonSchema', () => {
  it('returns empty fields for empty sample data', () => {
    const result = discoverJsonSchema('customer', []);
    expect(result.fields).toHaveLength(0);
    expect(result.rowCount).toBe(0);
  });

  it('infers string type for text fields', () => {
    const result = discoverJsonSchema('customer', [
      { name: 'Acme Corp', notes: 'some notes' },
      { name: 'Globex', notes: null },
    ]);
    const nameField = result.fields.find(f => f.name === 'name');
    expect(nameField?.inferredType).toBe('string');
  });

  it('infers email type for email fields', () => {
    const result = discoverJsonSchema('contact', [
      { email: 'alice@example.com' },
      { email: 'bob@example.com' },
    ]);
    const emailField = result.fields.find(f => f.name === 'email');
    expect(emailField?.inferredType).toBe('email');
    expect(emailField?.isPii).toBe(true);
  });

  it('infers number type for numeric string values', () => {
    const result = discoverJsonSchema('deal', [
      { amount: '50000' },
      { amount: '12000' },
    ]);
    const field = result.fields.find(f => f.name === 'amount');
    expect(field?.inferredType).toBe('number');
  });

  it('infers date type for ISO date strings', () => {
    const result = discoverJsonSchema('event', [
      { created_at: '2026-01-01' },
      { created_at: '2026-06-07' },
    ]);
    const field = result.fields.find(f => f.name === 'created_at');
    expect(field?.inferredType).toBe('date');
  });

  it('infers id type for fields ending in _id', () => {
    const result = discoverJsonSchema('record', [
      { workspace_id: 'ws-1' },
    ]);
    const field = result.fields.find(f => f.name === 'workspace_id');
    expect(field?.inferredType).toBe('id');
  });

  it('infers url type for http fields', () => {
    const result = discoverJsonSchema('link', [
      { website: 'https://example.com' },
      { website: 'http://acme.io' },
    ]);
    const field = result.fields.find(f => f.name === 'website');
    expect(field?.inferredType).toBe('url');
  });

  it('marks PII field names automatically', () => {
    const result = discoverJsonSchema('person', [
      { phone_number: '+1-555-1234', address: '123 Main St' },
    ]);
    const phone = result.fields.find(f => f.name === 'phone_number');
    const addr = result.fields.find(f => f.name === 'address');
    expect(phone?.isPii).toBe(true);
    expect(addr?.isPii).toBe(true);
  });

  it('does not mark non-PII fields as PII', () => {
    const result = discoverJsonSchema('deal', [
      { title: 'Enterprise Deal', stage: 'closed_won' },
    ]);
    for (const field of result.fields) {
      expect(field.isPii).toBe(false);
    }
  });

  it('calculates null rate correctly', () => {
    const result = discoverJsonSchema('item', [
      { notes: 'abc' },
      { notes: null },
      { notes: null },
      { notes: 'xyz' },
    ]);
    const field = result.fields.find(f => f.name === 'notes');
    expect(field?.nullRate).toBe(0.5);
  });

  it('collects up to 5 sample values', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ val: `v${i}` }));
    const result = discoverJsonSchema('x', rows);
    const field = result.fields.find(f => f.name === 'val');
    expect(field?.sampleValues.length).toBeLessThanOrEqual(5);
  });

  it('marks all fields as accepted by default', () => {
    const result = discoverJsonSchema('lead', [{ name: 'Alice', revenue: '5000' }]);
    expect(result.fields.every(f => f.accepted)).toBe(true);
  });

  it('handles boolean values', () => {
    const result = discoverJsonSchema('item', [
      { active: 'true' },
      { active: 'false' },
    ]);
    const field = result.fields.find(f => f.name === 'active');
    expect(field?.inferredType).toBe('boolean');
  });
});

// ─── discoverCsvSchema ────────────────────────────────────────────────────────

describe('discoverCsvSchema', () => {
  it('maps headers to fields', () => {
    const headers = ['name', 'email', 'amount'];
    const rows = [
      ['Alice', 'alice@example.com', '5000'],
      ['Bob', 'bob@example.com', '3000'],
    ];
    const result = discoverCsvSchema('customer', headers, rows);
    const names = result.fields.map(f => f.name);
    expect(names).toContain('name');
    expect(names).toContain('email');
    expect(names).toContain('amount');
  });

  it('infers types through row data', () => {
    const result = discoverCsvSchema('c', ['email'], [['alice@x.com'], ['bob@x.com']]);
    const f = result.fields.find(f => f.name === 'email');
    expect(f?.inferredType).toBe('email');
    expect(f?.isPii).toBe(true);
  });
});

// ─── discoverSchema ───────────────────────────────────────────────────────────

describe('discoverSchema', () => {
  it('discovers multiple entity types', () => {
    const result = discoverSchema({
      contact: [{ name: 'Alice', email: 'alice@x.com' }],
      deal: [{ title: 'Big Deal', amount: '50000' }],
    });
    expect(result.entityTypes).toHaveLength(2);
    expect(result.entityTypes.map(e => e.name)).toContain('contact');
    expect(result.entityTypes.map(e => e.name)).toContain('deal');
  });

  it('sets rawDataFormat to json', () => {
    const result = discoverSchema({ x: [{ a: 1 }] });
    expect(result.rawDataFormat).toBe('json');
  });

  it('sets discoveredAt to a recent date', () => {
    const before = new Date();
    const result = discoverSchema({});
    expect(result.discoveredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

// ─── SchemaDiscovererService ──────────────────────────────────────────────────

describe('SchemaDiscovererService', () => {
  const makeFields = (): SchemaFieldDecision[] => [
    { originalName: 'email', accepted: true, isPii: true },
    { originalName: 'name', accepted: true, isPii: false, renamedTo: 'full_name' },
    { originalName: 'internal_ref', accepted: false, isPii: false },
  ];

  it('saveConfirmation returns ok on success', async () => {
    const sql = vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new SchemaDiscovererService(sql);
    const result = await svc.saveConfirmation('inst-1', 'ws-1', 'contact', makeFields());
    expect(result.isOk()).toBe(true);
    const confirmation = result._unsafeUnwrap();
    expect(confirmation.instanceId).toBe('inst-1');
    expect(confirmation.entityType).toBe('contact');
    expect(confirmation.fields).toHaveLength(3);
  });

  it('saveConfirmation returns err on SQL failure', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('db fail'))) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new SchemaDiscovererService(sql);
    const result = await svc.saveConfirmation('inst-1', 'ws-1', 'contact', makeFields());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('db fail');
  });

  it('getConfirmations returns parsed confirmations', async () => {
    const fields = makeFields();
    const sql = vi.fn(() => Promise.resolve([{
      id: 'row-1',
      instance_id: 'inst-1',
      workspace_id: 'ws-1',
      entity_type: 'contact',
      fields: JSON.stringify(fields),
      confirmed_at: new Date('2026-06-07'),
    }])) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new SchemaDiscovererService(sql);
    const result = await svc.getConfirmations('inst-1', 'ws-1');
    expect(result.isOk()).toBe(true);
    const confirmations = result._unsafeUnwrap();
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]!.entityType).toBe('contact');
    expect(confirmations[0]!.fields).toHaveLength(3);
  });

  it('getConfirmations returns empty array when no rows', async () => {
    const sql = vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new SchemaDiscovererService(sql);
    const result = await svc.getConfirmations('inst-1', 'ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('getConfirmations returns err on SQL failure', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('conn error'))) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new SchemaDiscovererService(sql);
    const result = await svc.getConfirmations('inst-1', 'ws-1');
    expect(result.isErr()).toBe(true);
  });

  it('deleteConfirmations returns ok', async () => {
    const sql = vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new SchemaDiscovererService(sql);
    const result = await svc.deleteConfirmations('inst-1', 'ws-1');
    expect(result.isOk()).toBe(true);
  });
});
