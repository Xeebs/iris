import { describe, it, expect } from 'vitest';
import {
  estimateEntityTokens,
  encodeSSEEvent,
  encodeSSEDone,
  encodeSSEError,
  StreamingContextServer,
  type StreamChunk,
} from '../streaming-context.js';
import type { SemanticEntity } from '@iris/connector-sdk';

function makeEntity(id: string, label: string, type = 'contact'): SemanticEntity {
  return {
    id,
    type,
    label,
    attributes: { name: label, role: 'VP', company: 'Acme' },
    relationships: [],
    lastModified: new Date().toISOString(),
    sourceId: id,
  };
}

// ─── estimateEntityTokens ─────────────────────────────────────────────────────

describe('estimateEntityTokens', () => {
  it('returns a positive integer', () => {
    const tokens = estimateEntityTokens(makeEntity('e1', 'Alice Johnson'));
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
  });

  it('larger entities produce higher token counts', () => {
    const small = makeEntity('e1', 'Alice');
    const large: SemanticEntity = {
      ...makeEntity('e2', 'Alice Johnson Enterprise Relationship Manager'),
      attributes: { name: 'Alice', role: 'VP', email: 'alice@corp.com', company: 'Acme Corp', phone: '555-1234', city: 'Boston', region: 'Northeast', tier: 'enterprise' },
    };
    expect(estimateEntityTokens(large)).toBeGreaterThan(estimateEntityTokens(small));
  });

  it('uses char/4 rounding', () => {
    const entity = makeEntity('e1', 'A');
    const text = `${entity.type} ${entity.label} ${JSON.stringify(entity.attributes)}`;
    expect(estimateEntityTokens(entity)).toBe(Math.ceil(text.length / 4));
  });
});

// ─── encodeSSEEvent ───────────────────────────────────────────────────────────

describe('encodeSSEEvent', () => {
  it('produces data: prefixed line ending with double newline', () => {
    const chunk: StreamChunk = {
      metadata: { chunkIndex: 0, moreChunks: false, totalCount: 1, tokensInChunk: 10 },
      entities: [makeEntity('e1', 'Alice')],
    };
    const event = encodeSSEEvent(chunk);
    expect(event.startsWith('data: ')).toBe(true);
    expect(event.endsWith('\n\n')).toBe(true);
  });

  it('encodes valid JSON payload', () => {
    const chunk: StreamChunk = {
      metadata: { chunkIndex: 0, moreChunks: true, totalCount: 5, tokensInChunk: 42 },
      entities: [makeEntity('e1', 'Alice')],
    };
    const event = encodeSSEEvent(chunk);
    const payload = JSON.parse(event.replace('data: ', '').trim()) as StreamChunk;
    expect(payload.metadata.chunkIndex).toBe(0);
    expect(payload.metadata.moreChunks).toBe(true);
    expect(payload.entities).toHaveLength(1);
  });
});

// ─── encodeSSEDone ────────────────────────────────────────────────────────────

describe('encodeSSEDone', () => {
  it('returns [DONE] marker with correct SSE format', () => {
    const done = encodeSSEDone();
    expect(done).toBe('data: [DONE]\n\n');
  });
});

// ─── encodeSSEError ───────────────────────────────────────────────────────────

describe('encodeSSEError', () => {
  it('returns error JSON in SSE format', () => {
    const event = encodeSSEError('Something went wrong');
    expect(event.startsWith('data: ')).toBe(true);
    const payload = JSON.parse(event.replace('data: ', '').trim()) as { error: string };
    expect(payload.error).toBe('Something went wrong');
  });
});

// ─── StreamingContextServer.streamEntities ────────────────────────────────────

describe('StreamingContextServer.streamEntities', () => {
  it('yields zero chunks for empty entities array', () => {
    const server = new StreamingContextServer();
    const chunks = [...server.streamEntities([])];
    expect(chunks).toHaveLength(0);
  });

  it('yields a single chunk when all entities fit in token budget', () => {
    const server = new StreamingContextServer({ maxTokensPerChunk: 5000, maxEntitiesPerChunk: 50 });
    const entities = Array.from({ length: 5 }, (_, i) => makeEntity(`e${i}`, `Entity ${i}`));
    const chunks = [...server.streamEntities(entities)];
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.metadata.moreChunks).toBe(false);
  });

  it('splits entities across multiple chunks when token budget is small', () => {
    const server = new StreamingContextServer({ maxTokensPerChunk: 30, maxEntitiesPerChunk: 50 });
    const entities = Array.from({ length: 10 }, (_, i) => makeEntity(`e${i}`, `Entity ${i} Label Text`));
    const chunks = [...server.streamEntities(entities)];
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('respects maxEntitiesPerChunk limit', () => {
    const server = new StreamingContextServer({ maxTokensPerChunk: 99999, maxEntitiesPerChunk: 3 });
    const entities = Array.from({ length: 9 }, (_, i) => makeEntity(`e${i}`, `E${i}`));
    const chunks = [...server.streamEntities(entities)];
    for (const chunk of chunks) {
      expect(chunk.entities.length).toBeLessThanOrEqual(3);
    }
  });

  it('assigns sequential chunkIndex starting at 0', () => {
    const server = new StreamingContextServer({ maxTokensPerChunk: 30, maxEntitiesPerChunk: 2 });
    const entities = Array.from({ length: 6 }, (_, i) => makeEntity(`e${i}`, `E ${i} padded text here`));
    const chunks = [...server.streamEntities(entities)];
    chunks.forEach((chunk, i) => {
      expect(chunk.metadata.chunkIndex).toBe(i);
    });
  });

  it('moreChunks is true for all chunks except the last', () => {
    const server = new StreamingContextServer({ maxTokensPerChunk: 30, maxEntitiesPerChunk: 1 });
    const entities = Array.from({ length: 3 }, (_, i) => makeEntity(`e${i}`, `E ${i} some text`));
    const chunks = [...server.streamEntities(entities)];
    if (chunks.length > 1) {
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i]!.metadata.moreChunks).toBe(true);
      }
    }
    expect(chunks.at(-1)!.metadata.moreChunks).toBe(false);
  });

  it('reports correct totalCount from explicit parameter', () => {
    const server = new StreamingContextServer();
    const entities = [makeEntity('e1', 'Alice')];
    const chunks = [...server.streamEntities(entities, 500)];
    expect(chunks[0]!.metadata.totalCount).toBe(500);
  });

  it('tokensInChunk reflects actual token estimates', () => {
    const server = new StreamingContextServer();
    const entities = [makeEntity('e1', 'Alice'), makeEntity('e2', 'Bob')];
    const chunks = [...server.streamEntities(entities)];
    const expected = estimateEntityTokens(entities[0]!) + estimateEntityTokens(entities[1]!);
    expect(chunks[0]!.metadata.tokensInChunk).toBe(expected);
  });

  it('all source entities appear exactly once across all chunks', () => {
    const server = new StreamingContextServer({ maxTokensPerChunk: 50, maxEntitiesPerChunk: 5 });
    const entities = Array.from({ length: 20 }, (_, i) => makeEntity(`e${i}`, `Entity ${i}`));
    const chunks = [...server.streamEntities(entities)];
    const allIds = chunks.flatMap((c) => c.entities.map((e) => e.id));
    expect(allIds).toHaveLength(20);
    expect(new Set(allIds).size).toBe(20);
  });
});

// ─── StreamingContextServer.encodeStreamResponse ─────────────────────────────

describe('StreamingContextServer.encodeStreamResponse', () => {
  it('returns empty stream with just [DONE] for empty entities', () => {
    const server = new StreamingContextServer();
    const response = server.encodeStreamResponse([]);
    expect(response).toBe('data: [DONE]\n\n');
  });

  it('ends with [DONE] terminator', () => {
    const server = new StreamingContextServer();
    const entities = [makeEntity('e1', 'Alice')];
    const response = server.encodeStreamResponse(entities);
    expect(response.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('each data line is parseable JSON except [DONE]', () => {
    const server = new StreamingContextServer({ maxTokensPerChunk: 50, maxEntitiesPerChunk: 2 });
    const entities = Array.from({ length: 4 }, (_, i) => makeEntity(`e${i}`, `E${i}`));
    const response = server.encodeStreamResponse(entities);
    const lines = response.split('\n\n').filter(Boolean);
    for (const line of lines) {
      const payload = line.replace('data: ', '');
      if (payload !== '[DONE]') {
        expect(() => JSON.parse(payload)).not.toThrow();
      }
    }
  });

  it('token budget truncation: respects maxTokensPerChunk across all chunks', () => {
    const maxTokens = 50;
    const server = new StreamingContextServer({ maxTokensPerChunk: maxTokens, maxEntitiesPerChunk: 100 });
    const entities = Array.from({ length: 10 }, (_, i) =>
      makeEntity(`e${i}`, `Entity ${i} padded label text for sizing`)
    );
    const response = server.encodeStreamResponse(entities);
    const lines = response.split('\n\n').filter((l) => l !== '' && !l.includes('[DONE]'));
    for (const line of lines) {
      const chunk = JSON.parse(line.replace('data: ', '')) as StreamChunk;
      expect(chunk.metadata.tokensInChunk).toBeLessThanOrEqual(maxTokens + estimateEntityTokens(entities[0]!));
    }
  });
});
