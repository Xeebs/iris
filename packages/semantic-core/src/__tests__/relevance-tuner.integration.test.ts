import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { RelevanceTuner, DEFAULT_WEIGHTS } from '../relevance-tuner.js';

/** Requires: docker-compose up -d (Postgres on 5432) */
describe.skip('RelevanceTuner — integration', () => {
  let sql: ReturnType<typeof postgres>;
  let tuner: RelevanceTuner;

  beforeAll(async () => {
    sql = postgres({
      host: process.env['POSTGRES_HOST'] ?? 'localhost',
      port: parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10),
      database: process.env['POSTGRES_DB'] ?? 'iris_test',
      username: process.env['POSTGRES_USER'] ?? 'postgres',
      password: process.env['POSTGRES_PASSWORD'] ?? 'postgres',
    });

    await sql`
      CREATE TABLE IF NOT EXISTS search_feedback (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id      text NOT NULL,
        query             text NOT NULL,
        clicked_entity_id text NOT NULL,
        rank              integer NOT NULL,
        feedback_score    real NOT NULL DEFAULT 1.0,
        dwell_time_ms     integer,
        timestamp         timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS search_tuning_config (
        workspace_id  text NOT NULL,
        factor_name   text NOT NULL,
        tuned_value   real NOT NULL,
        updated_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, factor_name)
      )
    `;
    await sql`TRUNCATE search_feedback, search_tuning_config`;
    tuner = new RelevanceTuner(sql);
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS search_feedback, search_tuning_config`;
    await sql.end();
  });

  it('stores and loads a custom weight round-trip', async () => {
    await tuner.updateWeight({ workspaceId: 'ws-int', factorName: 'recency_boost', tunedValue: 0.25 });
    const weights = await tuner.loadWeights('ws-int');
    expect(weights.recency_boost).toBe(0.25);
    expect(weights.embedding_weight).toBe(DEFAULT_WEIGHTS.embedding_weight);
  });

  it('records feedback and returns it in analytics', async () => {
    await tuner.recordFeedback({
      workspaceId: 'ws-int',
      query: 'integration test query',
      clickedEntityId: 'e-int-1',
      rank: 3,
      feedbackScore: 1.0,
      dwellTimeMs: 5000,
    });

    const analytics = await tuner.analyzeFeedback('ws-int', 1);
    const entry = analytics.find((r) => r.query === 'integration test query');
    expect(entry).toBeDefined();
    expect(entry!.clickCount).toBeGreaterThanOrEqual(1);
  });

  it('resets weights and loads defaults', async () => {
    await tuner.resetWeights('ws-int');
    const weights = await tuner.loadWeights('ws-int');
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });
});
