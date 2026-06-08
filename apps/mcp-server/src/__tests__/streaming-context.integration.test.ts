import { describe, it, expect } from 'vitest';
import { renderAtLevel, predictExpansionLevel } from '../tools/streaming-context.js';
import type { SemanticEntity } from '@iris/connector-sdk';

/**
 * Integration-style tests for the streaming context tool.
 * These tests verify token savings without requiring a running MCP server.
 * Full server-level integration requires a running Qdrant + OpenAI key.
 */

function makeRichEntity(idx: number): SemanticEntity {
  return {
    id: `hubspot:contact:${idx}`,
    type: 'contact',
    label: `Contact ${idx} at Company ${idx}`,
    attributes: {
      email: `contact${idx}@company${idx}.com`,
      company: `Company ${idx} Inc`,
      phone: `555-${String(idx).padStart(4, '0')}`,
      stage: 'customer',
      owner: `user:${idx % 5}`,
      mrr: idx * 100,
      lastActivity: '2026-06-01',
      notes: `Long-running customer with ${idx} tickets this quarter`,
    },
    relationships: [
      { type: 'belongs_to', targetId: `hubspot:company:${idx}` },
      { type: 'assigned_to', targetId: `user:${idx % 5}` },
    ],
    lastModified: '2026-06-01T00:00:00Z',
    sourceId: `hubspot:contact:${idx}`,
  };
}

describe.skipIf(!process.env['INTEGRATION'])('StreamingContext (integration)', () => {
  it('summary level uses at least 40% fewer tokens than full for 10 rich entities', () => {
    const entities = Array.from({ length: 10 }, (_, i) => makeRichEntity(i));
    const summary = renderAtLevel(entities, 'summary', 8000);
    const full = renderAtLevel(entities, 'full', 8000);

    const reduction = 1 - summary.tokenEstimate / full.tokenEstimate;
    expect(reduction).toBeGreaterThanOrEqual(0.4);
    expect(summary.truncated).toBe(false);
    expect(full.truncated).toBe(false);
  });

  it('initial 500-token budget fits 10 entities at summary level', () => {
    const entities = Array.from({ length: 10 }, (_, i) => makeRichEntity(i));
    const result = renderAtLevel(entities, 'summary', 500);
    expect(result.truncated).toBe(false);
    expect(result.tokenEstimate).toBeLessThanOrEqual(500);
  });

  it('full expansion stays under maxBudget of 2000 tokens for 10 entities', () => {
    const entities = Array.from({ length: 10 }, (_, i) => makeRichEntity(i));
    const result = renderAtLevel(entities, 'full', 2000);
    expect(result.tokenEstimate).toBeLessThanOrEqual(2000);
  });

  it('expansion level prediction is consistent for contact queries', () => {
    const contactTypes = ['contact'];
    expect(predictExpansionLevel('find Alice Smith', contactTypes)).toBe('detailed');
    expect(predictExpansionLevel('list all contacts in Europe', contactTypes)).toBe('summary');
    expect(predictExpansionLevel("show Alice's full profile and relationships", contactTypes)).toBe('full');
  });
});
