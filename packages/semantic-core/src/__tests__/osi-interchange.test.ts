import { describe, it, expect } from 'vitest';
import {
  parseOsiDocument,
  classifyNode,
  extractEntityType,
} from '../osi-interchange.js';

const validOsiDoc = {
  '@context': { '@vocab': 'https://schema.iris.ai/v1/', iris: 'https://schema.iris.ai/v1/' },
  '@graph': [
    {
      '@id': 'ws1:contact:1',
      '@type': 'https://schema.iris.ai/v1/contact',
      label: 'Alice Smith',
      email: 'alice@example.com',
      sourceId: 'contact:1',
    },
    {
      '@id': 'term:arr',
      '@type': 'https://schema.iris.ai/v1/glossary_term',
      label: 'ARR',
      definition: 'Annual Recurring Revenue',
    },
    {
      '@id': 'metric:arr',
      '@type': 'https://schema.iris.ai/v1/metric',
      label: 'ARR',
      formula: 'MRR * 12',
      definition: 'Annual revenue',
    },
  ],
  exportedAt: '2026-01-01T00:00:00.000Z',
  workspaceId: 'ws1',
  totalNodes: 3,
};

describe('parseOsiDocument', () => {
  it('parses a valid OSI JSON string', () => {
    const result = parseOsiDocument(JSON.stringify(validOsiDoc));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value['@graph']).toHaveLength(3);
    }
  });

  it('returns error for invalid JSON', () => {
    const result = parseOsiDocument('{{{invalid json');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('parse');
    }
  });

  it('returns error when @graph is missing', () => {
    const bad = { ...validOsiDoc, '@graph': undefined };
    const result = parseOsiDocument(JSON.stringify(bad));
    expect(result.isErr()).toBe(true);
  });

  it('returns error when workspaceId is missing', () => {
    const bad = { ...validOsiDoc, workspaceId: '' };
    const result = parseOsiDocument(JSON.stringify(bad));
    expect(result.isErr()).toBe(true);
  });

  it('returns error when a node is missing @id', () => {
    const bad = {
      ...validOsiDoc,
      '@graph': [{ '@type': 'contact', label: 'X' }],
    };
    const result = parseOsiDocument(JSON.stringify(bad));
    expect(result.isErr()).toBe(true);
  });

  it('parses when the object is already an object (not a string)', () => {
    const result = parseOsiDocument(JSON.stringify(validOsiDoc));
    expect(result.isOk()).toBe(true);
  });
});

describe('classifyNode', () => {
  it('classifies entities', () => {
    const node = validOsiDoc['@graph'][0]!;
    expect(classifyNode(node)).toBe('entity');
  });

  it('classifies glossary terms', () => {
    const node = validOsiDoc['@graph'][1]!;
    expect(classifyNode(node)).toBe('glossary_term');
  });

  it('classifies metrics', () => {
    const node = validOsiDoc['@graph'][2]!;
    expect(classifyNode(node)).toBe('metric');
  });

  it('defaults to entity for unrecognized @type', () => {
    const node = { '@id': 'x', '@type': 'https://schema.iris.ai/v1/thing', label: 'X' };
    expect(classifyNode(node)).toBe('entity');
  });
});

describe('extractEntityType', () => {
  it('extracts the last path segment', () => {
    expect(extractEntityType('https://schema.iris.ai/v1/contact')).toBe('contact');
  });

  it('lowercases the result', () => {
    expect(extractEntityType('https://example.com/DEAL')).toBe('deal');
  });

  it('handles types without a URL path', () => {
    expect(extractEntityType('contact')).toBe('contact');
  });
});
