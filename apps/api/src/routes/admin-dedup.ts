import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { EntityDuplicateMatcher } from '@iris/semantic-core';
import type { VectorStore } from '@iris/semantic-core';
import { EntityDeduplicator } from '@iris/semantic-core/entity-deduplicator';

const log = logger.child({ route: 'admin-dedup' });

type SqlClient = ReturnType<typeof postgres>;

const analyzeQuerySchema = z.object({
  entityType: z.string().optional(),
  threshold: z.coerce.number().min(0).max(1).default(0.60),
  topK: z.coerce.number().int().min(1).max(20).default(5),
});

const mergeBodySchema = z.object({
  mergedBy: z.string().min(1).default('admin'),
  signals: z.object({
    nameSimilarity: z.number(),
    emailDomainMatch: z.boolean(),
    embeddingSimilarity: z.number(),
    compositeScore: z.number(),
  }),
});

const ruleConditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('exact'), field: z.string(), caseInsensitive: z.boolean().optional() }),
    z.object({ type: z.literal('fuzzy'), field: z.string(), maxNormalizedDistance: z.number().min(0).max(1).optional() }),
    z.object({
      type: z.literal('composite'),
      operator: z.enum(['AND', 'OR']),
      conditions: z.array(ruleConditionSchema),
    }),
  ]),
);

const defineRulesSchema = z.object({
  workspaceId: z.string().min(1),
  entityType: z.string().min(1),
  rules: z.array(z.object({
    name: z.string().min(1),
    condition: ruleConditionSchema,
    confidence: z.enum(['high', 'medium', 'low']).optional(),
  })).min(1),
  createdBy: z.string().optional(),
});

const previewSchema = z.object({
  workspaceId: z.string().min(1),
  entityType: z.string().min(1),
  rules: z.array(z.object({
    name: z.string().min(1),
    condition: ruleConditionSchema,
    confidence: z.enum(['high', 'medium', 'low']).optional(),
  })).min(1),
  entities: z.array(z.object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    attributes: z.record(z.unknown()),
    relationships: z.array(z.object({ type: z.string(), targetId: z.string() })),
    lastModified: z.coerce.date(),
    sourceId: z.string(),
  })).min(2),
});

/**
 * @param sql - Postgres client
 * @param vectorStore - Vector store for entity retrieval
 * @returns Hono router mounted at /admin/dedup
 */
export function createAdminDedupRoutes(
  sql: SqlClient,
  vectorStore: VectorStore,
): Hono {
  const app = new Hono();
  const matcher = new EntityDuplicateMatcher(vectorStore, sql);
  const deduplicator = new EntityDeduplicator(sql);

  app.post('/analyze', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const parsed = analyzeQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { entityType, threshold, topK } = parsed.data;

    const analyzeOpts = {
      ...(entityType ? { entityType } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      ...(topK !== undefined ? { topK } : {}),
    };
    const result = await matcher.analyze(workspaceId, analyzeOpts);

    if (result.isErr()) {
      log.error('Deduplication analysis failed', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Analysis failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  app.post('/merge/:canonicalId/:duplicateId', async (c) => {
    const canonicalId = c.req.param('canonicalId');
    const duplicateId = c.req.param('duplicateId');
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    let body: z.infer<typeof mergeBodySchema>;
    try {
      const raw = await c.req.json() as unknown;
      const parsed = mergeBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
      }
      body = parsed.data;
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400);
    }

    const result = await matcher.merge(workspaceId, canonicalId, duplicateId, body.signals, body.mergedBy);

    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('duplicate key') || msg.includes('conflict')) {
        return c.json({ error: { code: 'CONFLICT', message: 'Link already exists' } }, 409);
      }
      log.error('Merge failed', { workspaceId, canonicalId, duplicateId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Merge failed' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** POST /admin/dedup/rules — define deduplication rules */
  app.post('/rules', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400); }

    const parsed = defineRulesSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    try {
      const ids = await deduplicator.defineDeduplicationRules(
        parsed.data.workspaceId,
        parsed.data.entityType,
        parsed.data.rules as Parameters<typeof deduplicator.defineDeduplicationRules>[2],
        parsed.data.createdBy,
      );
      return c.json({ data: { ruleIds: ids, count: ids.length } }, 201);
    } catch (e) {
      log.error('Failed to define dedup rules', { error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save rules' } }, 500);
    }
  });

  /** GET /admin/dedup/rules?workspaceId=&entityType= — list rules */
  app.get('/rules', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const entityType = c.req.query('entityType');

    if (!workspaceId || !entityType) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId and entityType are required' } }, 400);
    }

    try {
      const rules = await deduplicator.getRules(workspaceId, entityType);
      return c.json({ data: { rules, count: rules.length } });
    } catch (e) {
      log.error('Failed to list dedup rules', { error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list rules' } }, 500);
    }
  });

  /** PUT /admin/dedup/rules/:id/test — preview rule matches on sample entities */
  app.put('/rules/:id/test', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400); }

    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { entities, rules } = parsed.data;
    const groups = deduplicator.previewRules(
      entities as Parameters<typeof deduplicator.previewRules>[0],
      rules as Parameters<typeof deduplicator.previewRules>[1],
    );

    return c.json({
      data: {
        groups: groups.map((g) => ({
          canonicalId: g.canonical.id,
          canonicalLabel: g.canonical.label,
          duplicates: g.duplicates.map((d) => ({ id: d.id, label: d.label })),
          score: Math.round(g.score * 100) / 100,
          firedRules: g.ruleIds,
        })),
        matchedPairs: groups.reduce((s, g) => s + g.duplicates.length, 0),
      },
    });
  });

  return app;
}
