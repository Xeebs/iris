import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'resource-streaming' });

type SqlClient = ReturnType<typeof postgres>;

export type ExpansionLevel = 'summary' | 'detailed' | 'full';

const EXPANSION_ORDER: ExpansionLevel[] = ['summary', 'detailed', 'full'];

/** Token budgets (approximate) per expansion level per entity */
const LEVEL_TOKEN_BUDGET: Record<ExpansionLevel, number> = {
  summary: 50,
  detailed: 150,
  full: 400,
};

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface ContentChunk {
  entityId: string;
  expansionLevel: ExpansionLevel;
  content: string;
  tokenCount: number;
  cancelled?: boolean;
}

export interface StreamSession {
  sessionId: string;
  workspaceId: string;
  clientId: string;
  query: string;
  expansionLevel: ExpansionLevel;
  cachedResults: ContentChunk[];
  createdAt: Date;
  expiresAt: Date;
}

export interface EntitySummary {
  id: string;
  type: string;
  label: string;
  attributes?: Record<string, unknown>;
  relationships?: { type: string; targetId: string }[];
}

/**
 * Manages progressive context expansion sessions for MCP resource streaming.
 * Clients can start at summary level and expand incrementally, with
 * server-side caching to avoid re-computing intermediate levels.
 */
export class ResourceStreamManager {
  private readonly sessionCache = new Map<string, StreamSession>();

  constructor(private readonly sql: SqlClient) {}

  /**
   * Start or resume a streaming session for a query.
   * If a session already exists for the same workspace+query+client, it is returned.
   *
   * @param workspaceId - Workspace for context isolation
   * @param clientId    - Caller identifier (used for dedup)
   * @param query       - Natural language query
   * @param level       - Initial expansion level
   * @param maxTokens   - Budget cap across all chunks
   */
  async startSession(
    workspaceId: string,
    clientId: string,
    query: string,
    level: ExpansionLevel = 'summary',
    maxTokens = 2000,
  ): Promise<Result<StreamSession, Error>> {
    try {
      const existing = await this.findSession(workspaceId, clientId, query, level);
      if (existing) return ok(existing);

      const sessionId = `${workspaceId}:${clientId}:${Buffer.from(query).toString('base64url').slice(0, 12)}:${Date.now()}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

      const session: StreamSession = {
        sessionId,
        workspaceId,
        clientId,
        query,
        expansionLevel: level,
        cachedResults: [],
        createdAt: now,
        expiresAt,
      };

      await this.sql`
        INSERT INTO mcp_resource_sessions
          (session_id, workspace_id, client_id, query, expansion_level, cached_results_json, created_at, expires_at)
        VALUES (
          ${sessionId}, ${workspaceId}, ${clientId}, ${query}, ${level},
          ${JSON.stringify([])}::jsonb, ${now}, ${expiresAt}
        )
      `;

      this.sessionCache.set(sessionId, session);
      log.info('Stream session started', { sessionId, workspaceId, level });
      return ok(session);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Build content chunks at the requested expansion level from a set of entities.
   * Stops when the token budget is exhausted.
   *
   * @param entities  - Entities to render
   * @param level     - Target expansion level
   * @param maxTokens - Budget cap
   * @param fieldFilter - Optional whitelist of attribute keys
   */
  buildChunks(
    entities: EntitySummary[],
    level: ExpansionLevel,
    maxTokens: number,
    fieldFilter?: string[],
  ): ContentChunk[] {
    const chunks: ContentChunk[] = [];
    let tokensUsed = 0;

    for (const entity of entities) {
      const chunk = this.buildEntityChunk(entity, level, fieldFilter);
      if (tokensUsed + chunk.tokenCount > maxTokens) break;
      chunks.push(chunk);
      tokensUsed += chunk.tokenCount;
    }

    return chunks;
  }

  /**
   * Expand an existing session to a higher detail level.
   * Returns the new chunks at the requested level, using cached lower levels.
   *
   * @param sessionId  - Existing session identifier
   * @param newLevel   - Level to expand to (must be higher than current)
   * @param entities   - Updated entity list (may be larger at detailed/full levels)
   * @param maxTokens  - Budget cap for the new level
   * @param fieldFilter - Optional attribute whitelist
   */
  async expandSession(
    sessionId: string,
    newLevel: ExpansionLevel,
    entities: EntitySummary[],
    maxTokens = 2000,
    fieldFilter?: string[],
  ): Promise<Result<ContentChunk[], Error>> {
    try {
      const session = await this.getSessionById(sessionId);
      if (!session) return err(new Error(`Session not found: ${sessionId}`));

      const currentIdx = EXPANSION_ORDER.indexOf(session.expansionLevel);
      const newIdx = EXPANSION_ORDER.indexOf(newLevel);
      if (newIdx <= currentIdx) {
        return err(new Error(`Cannot expand from ${session.expansionLevel} to ${newLevel} — must expand upward`));
      }

      const newChunks = this.buildChunks(entities, newLevel, maxTokens, fieldFilter);

      session.expansionLevel = newLevel;
      session.cachedResults = [...session.cachedResults, ...newChunks];

      await this.sql`
        UPDATE mcp_resource_sessions
        SET expansion_level = ${newLevel},
            cached_results_json = ${JSON.stringify(session.cachedResults)}::jsonb
        WHERE session_id = ${sessionId}
      `;

      this.sessionCache.set(sessionId, session);
      log.info('Session expanded', { sessionId, newLevel, chunkCount: newChunks.length });
      return ok(newChunks);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve all cached chunks for a session.
   *
   * @param sessionId - Session identifier
   */
  async getSessionChunks(sessionId: string): Promise<Result<ContentChunk[], Error>> {
    try {
      const session = await this.getSessionById(sessionId);
      if (!session) return err(new Error(`Session not found: ${sessionId}`));
      return ok(session.cachedResults);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Cancel a streaming session.
   * The session is not deleted but no further expansions are allowed.
   *
   * @param sessionId - Session to cancel
   */
  async cancelSession(sessionId: string): Promise<Result<void, Error>> {
    try {
      const session = this.sessionCache.get(sessionId);
      if (session) {
        session.cachedResults.push({ entityId: '__cancelled__', expansionLevel: session.expansionLevel, content: '', tokenCount: 0, cancelled: true });
        this.sessionCache.set(sessionId, session);
      }
      await this.sql`
        UPDATE mcp_resource_sessions SET expires_at = NOW() WHERE session_id = ${sessionId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Remove sessions that have passed their expiry time.
   */
  async cleanup(): Promise<Result<number, Error>> {
    try {
      const rows = await this.sql<{ count: string }[]>`
        DELETE FROM mcp_resource_sessions WHERE expires_at < NOW()
        RETURNING session_id
      `;
      const count = rows.length;
      for (const r of rows) {
        const row = r as { session_id: string };
        this.sessionCache.delete(row.session_id);
      }
      log.info('Session cleanup complete', { evicted: count });
      return ok(count);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private buildEntityChunk(entity: EntitySummary, level: ExpansionLevel, fieldFilter?: string[]): ContentChunk {
    const tokenBudget = LEVEL_TOKEN_BUDGET[level];

    let content: string;
    if (level === 'summary') {
      content = `${entity.type}: ${entity.label}`;
    } else if (level === 'detailed') {
      const attrs = Object.entries(entity.attributes ?? {})
        .filter(([k]) => !fieldFilter || fieldFilter.includes(k))
        .filter(([, v]) => v !== null)
        .slice(0, 8)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(', ');
      content = `${entity.type}: ${entity.label}${attrs ? '. ' + attrs : ''}`;
    } else {
      const attrs = Object.entries(entity.attributes ?? {})
        .filter(([k]) => !fieldFilter || fieldFilter.includes(k))
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(', ');
      const rels = (entity.relationships ?? [])
        .map((r) => `${r.type} → ${r.targetId}`)
        .join(', ');
      content = `${entity.type}: ${entity.label}${attrs ? '. ' + attrs : ''}${rels ? '. relations: ' + rels : ''}`;
    }

    const tokenCount = Math.min(tokenBudget, Math.ceil(content.length / 4));
    return { entityId: entity.id, expansionLevel: level, content, tokenCount };
  }

  private async findSession(
    workspaceId: string,
    clientId: string,
    query: string,
    level: ExpansionLevel,
  ): Promise<StreamSession | null> {
    type Row = { session_id: string; expansion_level: string; cached_results_json: ContentChunk[]; created_at: Date; expires_at: Date };
    const rows = await this.sql<Row[]>`
      SELECT session_id, expansion_level, cached_results_json, created_at, expires_at
      FROM mcp_resource_sessions
      WHERE workspace_id = ${workspaceId}
        AND client_id = ${clientId}
        AND query = ${query}
        AND expansion_level = ${level}
        AND expires_at > NOW()
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;

    const session: StreamSession = {
      sessionId: row.session_id,
      workspaceId,
      clientId,
      query,
      expansionLevel: row.expansion_level as ExpansionLevel,
      cachedResults: row.cached_results_json ?? [],
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
    this.sessionCache.set(session.sessionId, session);
    return session;
  }

  private async getSessionById(sessionId: string): Promise<StreamSession | null> {
    if (this.sessionCache.has(sessionId)) {
      return this.sessionCache.get(sessionId)!;
    }
    type Row = { workspace_id: string; client_id: string; query: string; expansion_level: string; cached_results_json: ContentChunk[]; created_at: Date; expires_at: Date };
    const rows = await this.sql<Row[]>`
      SELECT * FROM mcp_resource_sessions WHERE session_id = ${sessionId} AND expires_at > NOW() LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const session: StreamSession = {
      sessionId,
      workspaceId: row.workspace_id,
      clientId: row.client_id,
      query: row.query,
      expansionLevel: row.expansion_level as ExpansionLevel,
      cachedResults: row.cached_results_json ?? [],
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
    this.sessionCache.set(sessionId, session);
    return session;
  }
}
