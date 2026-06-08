import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/relationship-inference', () => ({
  suggestRelationshipCreation: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: [
      {
        id: 'rel1',
        sourceEntityId: 'hubspot:contact:123',
        targetEntityId: 'salesforce:company:456',
        relationshipTypePredicted: 'employed_by',
        confidenceScore: 0.89,
        discoveryMethod: 'cooccurrence',
        suggestedAt: new Date(),
        confirmedAt: null,
        rejectedAt: null,
      },
    ],
  })),
  confirmInferredRelationship: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  rejectInferredRelationship: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  detectImplicitRelationships: vi.fn((sId: string, sType: string, tId: string, tType: string, cooc: number, emb: number) => ({
    sourceEntityId: sId,
    targetEntityId: tId,
    confidence: Math.min(1, cooc * 0.4 + (sType !== tType ? 0.3 : 0) + emb * 0.3),
    discoveryMethod: cooc > emb ? 'cooccurrence' : 'embedding_similarity',
    predictedType: 'related_to',
    breakdown: { cooccurrenceWeight: cooc * 0.4, typeCompatibilityWeight: sType !== tType ? 0.3 : 0, embeddingSimilarityWeight: emb * 0.3 },
  })),
  validateInferredRelationship: vi.fn((rel: { confidence: number }) => rel.confidence >= 0.75),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import routeModule from '../routes/relationship-inference';

function buildApp() {
  const app = new Hono();
  app.route('/graph', routeModule);
  return app;
}

describe('GET /graph/inferred-relationships', () => {
  it('returns inferred relationship suggestions', async () => {
    const res = await buildApp().request('/graph/inferred-relationships', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string; confidenceScore: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.confidenceScore).toBe(0.89);
  });

  it('accepts topK parameter', async () => {
    const res = await buildApp().request('/graph/inferred-relationships?topK=5', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /graph/inferred/:relId/confirm', () => {
  it('confirms relationship and returns confirmed: true', async () => {
    const res = await buildApp().request('/graph/inferred/rel1/confirm', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { confirmed: boolean; relId: string } };
    expect(body.data.confirmed).toBe(true);
    expect(body.data.relId).toBe('rel1');
  });
});

describe('POST /graph/inferred/:relId/reject', () => {
  it('rejects relationship and returns rejected: true', async () => {
    const res = await buildApp().request('/graph/inferred/rel1/reject', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { rejected: boolean } };
    expect(body.data.rejected).toBe(true);
  });
});

describe('POST /graph/score-relationship', () => {
  it('returns confidence score for entity pair', async () => {
    const res = await buildApp().request('/graph/score-relationship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceEntityId: 'e1',
        sourceEntityType: 'contact',
        targetEntityId: 'e2',
        targetEntityType: 'company',
        cooccurrenceScore: 0.9,
        embeddingSimilarity: 0.8,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { confidence: number; meetsThreshold: boolean } };
    expect(body.data.confidence).toBeGreaterThan(0);
    expect(typeof body.data.meetsThreshold).toBe('boolean');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await buildApp().request('/graph/score-relationship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceEntityId: 'e1' }),
    });
    expect(res.status).toBe(400);
  });

  it('uses default scores of 0 when not provided', async () => {
    const res = await buildApp().request('/graph/score-relationship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceEntityId: 'e1',
        sourceEntityType: 'contact',
        targetEntityId: 'e2',
        targetEntityType: 'deal',
      }),
    });
    expect(res.status).toBe(200);
  });
});
