import { describe, it, expect } from 'vitest';
import {
  parseJsonImport,
  parseCsvImport,
  validateBatch,
  toSemanticEntity,
  serializeToJson,
  serializeToCsv,
} from '../batch-operations.js';

const validRecord = {
  id: 'contact:1',
  type: 'contact',
  label: 'Alice Smith',
  attributes: { email: 'alice@example.com' },
  relationships: [{ type: 'belongs_to', targetId: 'company:10' }],
  lastModified: '2026-01-10T00:00:00.000Z',
  sourceId: 'contact:1',
};

describe('parseJsonImport', () => {
  it('parses a valid JSON array', () => {
    const result = parseJsonImport(JSON.stringify([validRecord]));
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('contact:1');
  });

  it('throws when input is not an array', () => {
    expect(() => parseJsonImport(JSON.stringify(validRecord))).toThrow('array');
  });

  it('throws for malformed JSON', () => {
    expect(() => parseJsonImport('{{{invalid')).toThrow();
  });
});

describe('parseCsvImport', () => {
  const csv = [
    'id,type,label,attributes,relationships,lastModified,sourceId',
    `contact:2,contact,Bob Jones,"{""email"":""bob@example.com""}","[]",2026-02-01T00:00:00.000Z,contact:2`,
  ].join('\n');

  it('parses a valid CSV string', () => {
    const result = parseCsvImport(csv);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Bob Jones');
    expect(result[0]!.attributes).toEqual({ email: 'bob@example.com' });
  });

  it('throws when there is only a header row', () => {
    expect(() => parseCsvImport('id,type,label')).toThrow();
  });

  it('handles empty attributes gracefully', () => {
    const csvNoAttrs = [
      'id,type,label,attributes,relationships,lastModified,sourceId',
      'contact:3,contact,Carol Day,,,,',
    ].join('\n');
    const result = parseCsvImport(csvNoAttrs);
    expect(result[0]!.attributes).toEqual({});
  });

  it('parses multiple rows', () => {
    const multiCsv = [
      'id,type,label,attributes,relationships,lastModified,sourceId',
      'c1,contact,A,{},[],2026-01-01T00:00:00.000Z,c1',
      'c2,contact,B,{},[],2026-01-01T00:00:00.000Z,c2',
      'c3,contact,C,{},[],2026-01-01T00:00:00.000Z,c3',
    ].join('\n');
    expect(parseCsvImport(multiCsv)).toHaveLength(3);
  });
});

describe('validateBatch', () => {
  it('passes valid records', () => {
    const { valid, errors } = validateBatch([validRecord]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('rejects records missing required id', () => {
    const { valid, errors } = validateBatch([{ ...validRecord, id: '' }]);
    expect(valid).toHaveLength(0);
    expect(errors[0]!.field).toBe('id');
  });

  it('rejects records missing required type', () => {
    const { valid, errors } = validateBatch([{ ...validRecord, type: '' }]);
    expect(valid).toHaveLength(0);
    expect(errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('rejects records missing required label', () => {
    const { valid, errors } = validateBatch([{ ...validRecord, label: '' }]);
    expect(valid).toHaveLength(0);
    expect(errors.some((e) => e.field === 'label')).toBe(true);
  });

  it('separates valid and invalid records', () => {
    const records = [validRecord, { ...validRecord, id: '', label: 'Bad' }];
    const { valid, errors } = validateBatch(records);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.row).toBe(2);
  });

  it('reports the row number in errors (1-based)', () => {
    const { errors } = validateBatch([{ ...validRecord, id: '' }]);
    expect(errors[0]!.row).toBe(1);
  });

  it('accepts records with optional fields omitted', () => {
    const minimal = { id: 'x', type: 'contact', label: 'X', attributes: {} };
    const { valid, errors } = validateBatch([minimal]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });
});

describe('toSemanticEntity', () => {
  it('prefixes id with workspaceId', () => {
    const entity = toSemanticEntity(validRecord, 'ws1');
    expect(entity.id).toBe('ws1:contact:1');
  });

  it('maps lastModified to a Date', () => {
    const entity = toSemanticEntity(validRecord, 'ws1');
    expect(entity.lastModified).toBeInstanceOf(Date);
  });

  it('defaults lastModified to now when absent', () => {
    const record = { ...validRecord, lastModified: undefined };
    const before = Date.now();
    const entity = toSemanticEntity(record, 'ws1');
    const after = Date.now();
    expect(entity.lastModified.getTime()).toBeGreaterThanOrEqual(before);
    expect(entity.lastModified.getTime()).toBeLessThanOrEqual(after);
  });

  it('preserves attributes and relationships', () => {
    const entity = toSemanticEntity(validRecord, 'ws1');
    expect(entity.attributes).toEqual(validRecord.attributes);
    expect(entity.relationships).toEqual(validRecord.relationships);
  });
});

describe('serializeToJson', () => {
  const entity = toSemanticEntity(validRecord, 'ws1');

  it('produces valid JSON array', () => {
    const json = serializeToJson([entity]);
    const parsed = JSON.parse(json) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('serializes lastModified as ISO string', () => {
    const json = serializeToJson([entity]);
    const parsed = JSON.parse(json) as { lastModified: string }[];
    expect(typeof parsed[0]!.lastModified).toBe('string');
    expect(parsed[0]!.lastModified).toContain('T');
  });
});

describe('serializeToCsv', () => {
  const entity = toSemanticEntity(validRecord, 'ws1');

  it('produces header row', () => {
    const csv = serializeToCsv([entity]);
    expect(csv.startsWith('id,type,label')).toBe(true);
  });

  it('includes entity data', () => {
    const csv = serializeToCsv([entity]);
    expect(csv).toContain('Alice Smith');
    expect(csv).toContain('ws1:contact:1');
  });

  it('round-trip: CSV → parse → validate produces same label', () => {
    const csv = serializeToCsv([entity]);
    const records = parseCsvImport(csv);
    const { valid } = validateBatch(records);
    expect(valid[0]!.label).toBe('Alice Smith');
  });
});
