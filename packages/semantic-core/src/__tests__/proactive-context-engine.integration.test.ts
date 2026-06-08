import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { ProactiveContextEngine } from '../proactive-context-engine.js';

/**
 * Integration tests for ProactiveContextEngine against a real Postgres instance.
 * Requires: docker-compose up -d (Postgres on 5432)
 * Run with: pnpm test:integration --filter @iris/semantic-core
 */
const DB_URL = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';

const TEST_WORKSPACE = 'test-proactive-ws-001';
const TEST_AGENT = 'test-agent-001';

describe.skipIf(!process.env['DATABASE_URL'])('ProactiveContextEngine (integration)', () => {
  let sql: ReturnType<typeof postgres>;
  let engine: ProactiveContextEngine;

  beforeAll(async () => {
    sql = postgres(DB_URL);
    engine = new ProactiveContextEngine(sql as unknown as Parameters<typeof ProactiveContextEngine>[0]);

    // Ensure tables exist (idempotent)
    await sql`
      CREATE TABLE IF NOT EXISTS agent_behavior_profiles (
        workspace_id        text NOT NULL,
        agent_id            text NOT NULL,
        entity_types        text[] NOT NULL DEFAULT '{}',
        query_patterns_json jsonb NOT NULL DEFAULT '{}',
        total_queries       int NOT NULL DEFAULT 0,
        learned_at          timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, agent_id)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS proactive_suggestions (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id    text NOT NULL,
        agent_id        text NOT NULL,
        entity_types    text[] NOT NULL DEFAULT '{}',
        context_hints   text[] NOT NULL DEFAULT '{}',
        score           numeric(5,4) NOT NULL DEFAULT 0,
        accepted        boolean DEFAULT NULL,
        feedback        text CHECK (feedback IN ('accepted', 'ignored', 'modified')) DEFAULT NULL,
        feedback_score  numeric(3,2) DEFAULT NULL,
        feedback_at     timestamptz DEFAULT NULL,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS agent_proactive_settings (
        workspace_id         text NOT NULL,
        agent_id             text NOT NULL,
        aggressiveness       text NOT NULL DEFAULT 'medium' CHECK (aggressiveness IN ('low', 'medium', 'high')),
        enabled_entity_types text[] NOT NULL DEFAULT '{}',
        updated_at           timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, agent_id)
      )
    `;
  });

  beforeEach(async () => {
    // Clean test data between tests
    await sql`DELETE FROM proactive_suggestions WHERE workspace_id = ${TEST_WORKSPACE}`;
    await sql`DELETE FROM agent_behavior_profiles WHERE workspace_id = ${TEST_WORKSPACE}`;
    await sql`DELETE FROM agent_proactive_settings WHERE workspace_id = ${TEST_WORKSPACE}`;
  });

  afterAll(async () => {
    await sql`DELETE FROM proactive_suggestions WHERE workspace_id = ${TEST_WORKSPACE}`;
    await sql`DELETE FROM agent_behavior_profiles WHERE workspace_id = ${TEST_WORKSPACE}`;
    await sql`DELETE FROM agent_proactive_settings WHERE workspace_id = ${TEST_WORKSPACE}`;
    await sql.end();
  });

  // ---------------------------------------------------------------------------
  // recordQueryEvent
  // ---------------------------------------------------------------------------

  it('records first query event and creates a behavioral profile', async () => {
    const result = await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['contact'], 'find-contacts');
    expect(result.isOk()).toBe(true);

    const profileResult = await engine.getAgentProfile(TEST_WORKSPACE, TEST_AGENT);
    expect(profileResult.isOk()).toBe(true);
    if (!profileResult.isOk()) return;

    const profile = profileResult.value;
    expect(profile).not.toBeNull();
    expect(profile!.totalQueries).toBe(1);
    expect(profile!.frequentEntityTypes).toContain('contact');
    expect(profile!.queryPatterns['find-contacts']).toBe(1);
  });

  it('accumulates query counts on repeated events', async () => {
    for (let i = 0; i < 5; i++) {
      await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['deal'], 'check-pipeline');
    }

    const profileResult = await engine.getAgentProfile(TEST_WORKSPACE, TEST_AGENT);
    expect(profileResult.isOk()).toBe(true);
    const profile = profileResult.value!;
    expect(profile!.totalQueries).toBe(5);
    expect(profile!.queryPatterns['check-pipeline']).toBe(5);
  });

  it('merges entity types across multiple query events', async () => {
    await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['contact'], 'contacts');
    await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['deal'], 'deals');
    await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['company'], 'companies');

    const profileResult = await engine.getAgentProfile(TEST_WORKSPACE, TEST_AGENT);
    const profile = profileResult.value!;
    expect(profile!.frequentEntityTypes).toContain('contact');
    expect(profile!.frequentEntityTypes).toContain('deal');
    expect(profile!.frequentEntityTypes).toContain('company');
  });

  it('handles concurrent query events without race conditions', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      engine.recordQueryEvent(TEST_WORKSPACE, `${TEST_AGENT}-concurrent`, ['contact'], `query-${i % 3}`),
    );
    const results = await Promise.all(promises);
    expect(results.every((r) => r.isOk())).toBe(true);

    const profileResult = await engine.getAgentProfile(TEST_WORKSPACE, `${TEST_AGENT}-concurrent`);
    const profile = profileResult.value!;
    expect(profile!.totalQueries).toBe(10);
  });

  // ---------------------------------------------------------------------------
  // getAgentProfile
  // ---------------------------------------------------------------------------

  it('returns null for an agent with no history', async () => {
    const result = await engine.getAgentProfile(TEST_WORKSPACE, 'never-seen-agent');
    expect(result.isOk()).toBe(true);
    expect(result.value).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // predictContext
  // ---------------------------------------------------------------------------

  it('returns empty array when agent has fewer than 3 queries', async () => {
    await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['contact'], 'contacts');
    await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['deal'], 'deals');

    const result = await engine.predictContext(TEST_WORKSPACE, TEST_AGENT, 'pipeline review');
    expect(result.isOk()).toBe(true);
    expect(result.value).toHaveLength(0);
  });

  it('generates suggestions after sufficient query history', async () => {
    for (let i = 0; i < 5; i++) {
      await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['contact', 'deal'], 'pipeline');
    }

    const result = await engine.predictContext(TEST_WORKSPACE, TEST_AGENT, 'show pipeline status');
    expect(result.isOk()).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);

    const suggestion = result.value[0]!;
    expect(suggestion.workspaceId).toBe(TEST_WORKSPACE);
    expect(suggestion.agentId).toBe(TEST_AGENT);
    expect(suggestion.entityTypes.length).toBeGreaterThan(0);
    expect(suggestion.contextHints.length).toBeGreaterThan(0);
    expect(suggestion.score).toBeGreaterThan(0);
    expect(suggestion.score).toBeLessThanOrEqual(1);
  });

  it('stores suggestion in DB and returns a valid ID', async () => {
    for (let i = 0; i < 5; i++) {
      await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['contact'], 'contacts');
    }

    const result = await engine.predictContext(TEST_WORKSPACE, TEST_AGENT, 'contact review');
    expect(result.isOk()).toBe(true);
    if (!result.isOk() || result.value.length === 0) return;

    const suggestionId = result.value[0]!.id;
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM proactive_suggestions WHERE id = ${suggestionId}::uuid
    `;
    expect(row).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // recordFeedback
  // ---------------------------------------------------------------------------

  it('records accepted feedback on a suggestion', async () => {
    for (let i = 0; i < 5; i++) {
      await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['contact'], 'contacts');
    }

    const suggResult = await engine.predictContext(TEST_WORKSPACE, TEST_AGENT, 'review');
    expect(suggResult.isOk()).toBe(true);
    if (!suggResult.isOk() || suggResult.value.length === 0) return;

    const suggestionId = suggResult.value[0]!.id;
    const feedbackResult = await engine.recordFeedback({
      workspaceId: TEST_WORKSPACE,
      agentId: TEST_AGENT,
      suggestionId,
      feedback: 'accepted',
      feedbackScore: 0.9,
    });

    expect(feedbackResult.isOk()).toBe(true);

    const [row] = await sql<{ accepted: boolean; feedback: string; feedback_score: string }[]>`
      SELECT accepted, feedback, feedback_score FROM proactive_suggestions WHERE id = ${suggestionId}::uuid
    `;
    expect(row?.accepted).toBe(true);
    expect(row?.feedback).toBe('accepted');
    expect(Number(row?.feedback_score)).toBeCloseTo(0.9, 1);
  });

  it('records ignored feedback correctly', async () => {
    for (let i = 0; i < 5; i++) {
      await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['deal'], 'deals');
    }

    const suggResult = await engine.predictContext(TEST_WORKSPACE, TEST_AGENT, 'deals');
    if (!suggResult.isOk() || suggResult.value.length === 0) return;

    const suggestionId = suggResult.value[0]!.id;
    await engine.recordFeedback({
      workspaceId: TEST_WORKSPACE,
      agentId: TEST_AGENT,
      suggestionId,
      feedback: 'ignored',
    });

    const [row] = await sql<{ accepted: boolean | null; feedback: string }[]>`
      SELECT accepted, feedback FROM proactive_suggestions WHERE id = ${suggestionId}::uuid
    `;
    expect(row?.accepted).toBe(false);
    expect(row?.feedback).toBe('ignored');
  });

  // ---------------------------------------------------------------------------
  // saveSettings
  // ---------------------------------------------------------------------------

  it('saves and updates proactive settings', async () => {
    const result = await engine.saveSettings(TEST_WORKSPACE, TEST_AGENT, 'high', ['contact', 'deal']);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.aggressiveness).toBe('high');
    expect(result.value.enabledEntityTypes).toContain('contact');

    // Update settings
    const updated = await engine.saveSettings(TEST_WORKSPACE, TEST_AGENT, 'low', ['company']);
    expect(updated.isOk()).toBe(true);
    expect(updated.value?.aggressiveness).toBe('low');
    expect(updated.value?.enabledEntityTypes).toContain('company');
  });

  // ---------------------------------------------------------------------------
  // Stale suggestion cache cleanup
  // ---------------------------------------------------------------------------

  it('suggestion score increases with more query history', async () => {
    // Score = min(1, total_queries / 100)
    for (let i = 0; i < 5; i++) {
      await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['contact'], 'contacts');
    }
    const lowResult = await engine.predictContext(TEST_WORKSPACE, TEST_AGENT, 'review');
    const lowScore = lowResult.value?.[0]?.score ?? 0;

    // Add more queries to same agent
    for (let i = 0; i < 45; i++) {
      await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['contact'], 'contacts');
    }
    const highResult = await engine.predictContext(TEST_WORKSPACE, TEST_AGENT, 'review');
    const highScore = highResult.value?.[0]?.score ?? 0;

    expect(highScore).toBeGreaterThanOrEqual(lowScore);
  });

  it('handles edge case: agent queries only single entity type', async () => {
    for (let i = 0; i < 5; i++) {
      await engine.recordQueryEvent(TEST_WORKSPACE, TEST_AGENT, ['ticket'], 'open-tickets');
    }

    const result = await engine.predictContext(TEST_WORKSPACE, TEST_AGENT, 'current tickets');
    expect(result.isOk()).toBe(true);
    if (!result.isOk() || result.value.length === 0) return;

    expect(result.value[0]!.entityTypes).toContain('ticket');
  });
});
