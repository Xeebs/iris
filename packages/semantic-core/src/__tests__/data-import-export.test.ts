import { describe, it, expect, vi } from 'vitest';
import {
  parseCSV,
  parseJSON,
  detectSchema,
  validateMapping,
  transformRows,
  serializeToCSV,
  serializeToJSON,
  batchInsert,
  MAX_ENTITY_COUNT,
  type FieldMapping,
} from '../data-import-export.js';

const SAMPLE_MAPPING: FieldMapping = {
  entityType: 'contact',
  labelColumn: 'name',
  idColumn: 'id',
  attributeMap: { email: 'email', company: 'company' },
};

describe('parseCSV', () => {
  it('parses a simple CSV string', () => {
    const csv = 'name,email\nAlice,alice@example.com\nBob,bob@example.com';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Alice', email: 'alice@example.com' });
    expect(rows[1]).toEqual({ name: 'Bob', email: 'bob@example.com' });
  });

  it('handles quoted fields with embedded commas', () => {
    const csv = 'name,company\n"Smith, John","Acme, Inc."';
    const rows = parseCSV(csv);
    expect(rows[0]!['name']).toBe('Smith, John');
    expect(rows[0]!['company']).toBe('Acme, Inc.');
  });

  it('handles escaped quotes inside quoted fields', () => {
    const csv = 'title\n"He said ""hello"""';
    const rows = parseCSV(csv);
    expect(rows[0]!['title']).toBe('He said "hello"');
  });

  it('returns empty array when fewer than 2 lines', () => {
    expect(parseCSV('name,email')).toEqual([]);
    expect(parseCSV('')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const csv = 'name,email\r\nAlice,a@a.com';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['name']).toBe('Alice');
  });
});

describe('parseJSON', () => {
  it('parses a JSON array', () => {
    const json = JSON.stringify([{ name: 'Alice', email: 'alice@example.com' }]);
    const rows = parseJSON(json);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['name']).toBe('Alice');
  });

  it('parses an object with a data array', () => {
    const json = JSON.stringify({ data: [{ name: 'Bob' }] });
    const rows = parseJSON(json);
    expect(rows[0]!['name']).toBe('Bob');
  });

  it('converts non-string values to strings', () => {
    const json = JSON.stringify([{ count: 42, active: true, missing: null }]);
    const rows = parseJSON(json);
    expect(rows[0]!['count']).toBe('42');
    expect(rows[0]!['active']).toBe('true');
    expect(rows[0]!['missing']).toBe('');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJSON('not json')).toThrow('Invalid JSON');
  });

  it('returns empty array when root is a non-object primitive', () => {
    // string primitive has no "data" property → defaults to empty array
    expect(parseJSON('"string"')).toEqual([]);
  });
});

describe('detectSchema', () => {
  it('returns columns from first 100 rows', () => {
    const rows = [{ a: '1', b: '2' }, { a: '3', c: '4' }];
    const schema = detectSchema(rows);
    expect(schema.columns).toContain('a');
    expect(schema.columns).toContain('b');
    expect(schema.columns).toContain('c');
  });

  it('returns at most 5 sample rows', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
    const schema = detectSchema(rows);
    expect(schema.sampleRows).toHaveLength(5);
    expect(schema.rowCount).toBe(10);
  });

  it('returns empty columns for no rows', () => {
    const schema = detectSchema([]);
    expect(schema.columns).toEqual([]);
    expect(schema.rowCount).toBe(0);
  });
});

describe('validateMapping', () => {
  const rows = [{ id: '1', name: 'Alice', email: 'a@a.com', company: 'Acme', extra: 'x' }];

  it('returns valid for a correct mapping', () => {
    const result = validateMapping(rows, SAMPLE_MAPPING);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when labelColumn is missing from input', () => {
    const result = validateMapping(rows, { ...SAMPLE_MAPPING, labelColumn: 'nonexistent' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('labelColumn');
  });

  it('errors when idColumn is missing from input', () => {
    const result = validateMapping(rows, { ...SAMPLE_MAPPING, idColumn: 'nonexistent' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('idColumn');
  });

  it('warns about unmapped columns', () => {
    const result = validateMapping(rows, SAMPLE_MAPPING);
    expect(result.warnings[0]).toContain('not mapped');
    expect(result.unmappedColumns).toContain('extra');
  });

  it('errors when row count exceeds MAX_ENTITY_COUNT', () => {
    const manyRows = Array.from({ length: MAX_ENTITY_COUNT + 1 }, () => ({ name: 'x', id: '1' }));
    const result = validateMapping(manyRows, { ...SAMPLE_MAPPING, attributeMap: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds maximum'))).toBe(true);
  });

  it('returns invalid for empty rows', () => {
    const result = validateMapping([], SAMPLE_MAPPING);
    expect(result.valid).toBe(false);
  });
});

describe('transformRows', () => {
  const rows = [
    { id: 'c1', name: 'Alice', email: 'alice@example.com', company: 'Acme' },
    { id: 'c2', name: 'Bob', email: 'bob@example.com', company: '' },
    { id: 'c3', name: '', email: 'x@x.com', company: '' },
  ];

  it('transforms rows to SemanticEntity objects', () => {
    const { entities } = transformRows(rows, SAMPLE_MAPPING, 'import');
    expect(entities).toHaveLength(2); // row 3 skipped (empty label)
    expect(entities[0]!.id).toBe('import:contact:c1');
    expect(entities[0]!.label).toBe('Alice');
    expect(entities[0]!.attributes['email']).toBe('alice@example.com');
    expect(entities[0]!.type).toBe('contact');
  });

  it('skips rows with missing label and records error', () => {
    const { entities, errors } = transformRows(rows, SAMPLE_MAPPING, 'import');
    expect(entities).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rowIndex).toBe(2);
  });

  it('falls back to row index when idColumn value is absent', () => {
    const { entities } = transformRows(
      [{ name: 'Alice', email: 'a@a.com' }],
      { entityType: 'contact', labelColumn: 'name', attributeMap: { email: 'email' } },
      'import',
    );
    expect(entities[0]!.id).toBe('import:contact:0');
  });

  it('omits empty attribute values', () => {
    const { entities } = transformRows(rows, SAMPLE_MAPPING, 'import');
    expect(entities[1]!.attributes['company']).toBeUndefined();
  });

  it('returns empty entities and no errors for empty input', () => {
    const { entities, errors } = transformRows([], SAMPLE_MAPPING, 'import');
    expect(entities).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

describe('serializeToCSV', () => {
  const entity = {
    id: 'import:contact:1',
    type: 'contact',
    label: 'Alice',
    attributes: { email: 'alice@example.com', tags: ['vip', 'customer'] as unknown as string },
    relationships: [],
    lastModified: new Date('2026-01-01T00:00:00Z'),
    sourceId: 'import:contact:1',
  };

  it('returns empty string for no entities', () => {
    expect(serializeToCSV([])).toBe('');
  });

  it('produces a CSV header row', () => {
    const csv = serializeToCSV([entity]);
    const firstLine = csv.split('\n')[0]!;
    expect(firstLine).toContain('id');
    expect(firstLine).toContain('type');
    expect(firstLine).toContain('label');
    expect(firstLine).toContain('email');
  });

  it('serializes array attributes with pipe separator', () => {
    const csv = serializeToCSV([entity]);
    expect(csv).toContain('vip|customer');
  });

  it('escapes CSV fields containing commas', () => {
    const e = { ...entity, label: 'Smith, Jane' };
    const csv = serializeToCSV([e]);
    expect(csv).toContain('"Smith, Jane"');
  });
});

describe('serializeToJSON', () => {
  it('returns empty array for no entities', () => {
    const json = JSON.parse(serializeToJSON([]));
    expect(json.data).toEqual([]);
    expect(json.count).toBe(0);
  });

  it('serializes entities with count', () => {
    const entity = {
      id: 'x', type: 'contact', label: 'Alice',
      attributes: {}, relationships: [],
      lastModified: new Date(), sourceId: 'x',
    };
    const json = JSON.parse(serializeToJSON([entity]));
    expect(json.count).toBe(1);
    expect(json.data[0].id).toBe('x');
  });
});

describe('batchInsert', () => {
  it('calls upsert and returns result', async () => {
    const upsert = vi.fn().mockResolvedValue(3);
    const entities = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`, type: 'contact', label: `E${i}`,
      attributes: {}, relationships: [], lastModified: new Date(), sourceId: `e${i}`,
    }));

    const result = await batchInsert(entities, 'ws-1', upsert);
    expect(result.inserted).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(upsert).toHaveBeenCalledWith(entities, 'ws-1');
  });

  it('throws when entity count exceeds MAX_ENTITY_COUNT', async () => {
    const upsert = vi.fn();
    const entities = Array.from({ length: MAX_ENTITY_COUNT + 1 }, (_, i) => ({
      id: `e${i}`, type: 'contact', label: `E${i}`,
      attributes: {}, relationships: [], lastModified: new Date(), sourceId: `e${i}`,
    }));

    await expect(batchInsert(entities, 'ws-1', upsert)).rejects.toThrow('exceeds maximum');
    expect(upsert).not.toHaveBeenCalled();
  });
});
