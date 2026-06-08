import { describe, it, expect } from 'vitest';
import {
  parseAcceptHeader,
  selectFormat,
  csvEscapeField,
  serializeAsCsv,
  serializeAsJson,
  contentTypeFor,
  contentDispositionFor,
  ResponseSerializer,
} from '../response-serializer.js';

describe('parseAcceptHeader', () => {
  it('defaults to json for null/empty', () => {
    const result = parseAcceptHeader(null);
    expect(result).toHaveLength(1);
    expect(result[0]!.format).toBe('json');
  });

  it('parses application/json', () => {
    const result = parseAcceptHeader('application/json');
    expect(result[0]!.format).toBe('json');
    expect(result[0]!.quality).toBe(1);
  });

  it('parses text/csv', () => {
    const result = parseAcceptHeader('text/csv');
    expect(result[0]!.format).toBe('csv');
  });

  it('parses quality values', () => {
    const result = parseAcceptHeader('application/json;q=0.5, text/csv;q=0.9');
    expect(result[0]!.format).toBe('csv');
    expect(result[1]!.format).toBe('json');
  });

  it('handles */* as json', () => {
    const result = parseAcceptHeader('*/*');
    expect(result[0]!.format).toBe('json');
  });

  it('ignores unknown MIME types', () => {
    const result = parseAcceptHeader('application/xml');
    expect(result).toHaveLength(0);
  });
});

describe('selectFormat', () => {
  it('selects preferred format from available', () => {
    expect(selectFormat('text/csv', ['json', 'csv'])).toBe('csv');
  });

  it('falls back to json when no match', () => {
    expect(selectFormat('application/xml', ['json', 'csv'])).toBe('json');
  });

  it('respects quality ordering', () => {
    const result = selectFormat('application/json;q=0.3, text/csv;q=0.9', ['json', 'csv']);
    expect(result).toBe('csv');
  });

  it('defaults to json for null', () => {
    expect(selectFormat(null)).toBe('json');
  });
});

describe('csvEscapeField', () => {
  it('returns empty string for null/undefined', () => {
    expect(csvEscapeField(null)).toBe('');
    expect(csvEscapeField(undefined)).toBe('');
  });

  it('passes through simple strings', () => {
    expect(csvEscapeField('hello')).toBe('hello');
  });

  it('wraps in quotes when contains comma', () => {
    expect(csvEscapeField('a,b')).toBe('"a,b"');
  });

  it('escapes double quotes', () => {
    expect(csvEscapeField('say "hi"')).toBe('"say ""hi"""');
  });

  it('converts numbers to strings', () => {
    expect(csvEscapeField(42)).toBe('42');
  });
});

describe('serializeAsCsv', () => {
  it('returns empty string for empty array', () => {
    expect(serializeAsCsv([])).toBe('');
  });

  it('produces header row and data rows', () => {
    const csv = serializeAsCsv([
      { id: '1', name: 'Alice', age: 30 },
      { id: '2', name: 'Bob', age: 25 },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('age,id,name'); // sorted columns
    expect(lines[1]).toBe('30,1,Alice');
    expect(lines[2]).toBe('25,2,Bob');
  });

  it('handles missing fields with empty cells', () => {
    const csv = serializeAsCsv([{ id: '1', name: 'Alice' }, { id: '2' }]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('id,name');
    expect(lines[2]).toBe('2,'); // missing name
  });
});

describe('serializeAsJson', () => {
  it('wraps records in data envelope', () => {
    const json = JSON.parse(serializeAsJson([{ id: '1' }]));
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe('1');
  });

  it('includes meta when provided', () => {
    const json = JSON.parse(serializeAsJson([], { total: 0 }));
    expect(json.meta).toEqual({ total: 0 });
  });
});

describe('contentTypeFor', () => {
  it('returns application/json for json', () => {
    expect(contentTypeFor('json')).toContain('application/json');
  });

  it('returns text/csv for csv', () => {
    expect(contentTypeFor('csv')).toContain('text/csv');
  });

  it('returns parquet MIME for parquet', () => {
    expect(contentTypeFor('parquet')).toContain('parquet');
  });
});

describe('contentDispositionFor', () => {
  it('returns null for json', () => {
    expect(contentDispositionFor('json')).toBeNull();
  });

  it('returns attachment header for csv', () => {
    const d = contentDispositionFor('csv', 'entities');
    expect(d).toBe('attachment; filename="entities.csv"');
  });

  it('returns attachment header for parquet', () => {
    const d = contentDispositionFor('parquet', 'data');
    expect(d).toBe('attachment; filename="data.parquet"');
  });
});

describe('ResponseSerializer', () => {
  const records = [{ id: '1', type: 'contact', label: 'Alice' }];

  it('serializes to json by default', () => {
    const s = new ResponseSerializer();
    const { body, contentType, contentDisposition } = s.serialize(records, 'json');
    expect(contentType).toContain('application/json');
    expect(contentDisposition).toBeNull();
    const parsed = JSON.parse(body as string);
    expect(parsed.data).toHaveLength(1);
  });

  it('serializes to csv', () => {
    const s = new ResponseSerializer();
    const { body, contentType, contentDisposition } = s.serialize(records, 'csv', 'contacts');
    expect(contentType).toContain('text/csv');
    expect(contentDisposition).toContain('contacts.csv');
    const csv = body as string;
    expect(csv).toContain('id,label,type');
  });
});
