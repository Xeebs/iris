import { Hono } from 'hono';
import type { Sql } from 'postgres';

type SessionRow = {
  session_id: string;
  workspace_id: string;
  question: string;
  intent: { type?: string; confidence?: number };
  query_plan: Record<string, unknown>;
  follow_up_questions: string[];
  is_favorite: boolean;
  created_at: Date;
};

type FeedbackRow = {
  session_id: string;
  helpful: boolean;
  notes: string | null;
  created_at: Date;
};

/**
 * REST routes for NL query session persistence.
 * Base path: /api/v1/nl-queries
 *
 * @param sql - Postgres sql instance
 */
export function createNlQuerySessionsRoutes(sql: Sql) {
  const app = new Hono();

  // GET /sessions — paginated session list
  app.get('/sessions', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';
    const cursor = c.req.query('cursor');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const favoritesOnly = c.req.query('favoritesOnly') === 'true';

    try {
      let rows: SessionRow[];
      if (favoritesOnly && cursor) {
        rows = await sql`
          SELECT session_id, workspace_id, question, intent, query_plan,
                 follow_up_questions, is_favorite, created_at
          FROM nlquery_sessions
          WHERE workspace_id = ${workspaceId} AND is_favorite = true
            AND session_id > ${cursor}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` as SessionRow[];
      } else if (favoritesOnly) {
        rows = await sql`
          SELECT session_id, workspace_id, question, intent, query_plan,
                 follow_up_questions, is_favorite, created_at
          FROM nlquery_sessions
          WHERE workspace_id = ${workspaceId} AND is_favorite = true
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` as SessionRow[];
      } else if (cursor) {
        rows = await sql`
          SELECT session_id, workspace_id, question, intent, query_plan,
                 follow_up_questions, is_favorite, created_at
          FROM nlquery_sessions
          WHERE workspace_id = ${workspaceId} AND session_id > ${cursor}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` as SessionRow[];
      } else {
        rows = await sql`
          SELECT session_id, workspace_id, question, intent, query_plan,
                 follow_up_questions, is_favorite, created_at
          FROM nlquery_sessions
          WHERE workspace_id = ${workspaceId}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` as SessionRow[];
      }

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? page[page.length - 1]!.session_id : null;

      return c.json({
        data: page.map(sessionToResponse),
        meta: { hasMore, nextCursor },
      });
    } catch {
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch sessions' } }, 500);
    }
  });

  // GET /sessions/:id — full session with feedback
  app.get('/sessions/:id', async (c) => {
    const sessionId = c.req.param('id');
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';

    try {
      const sessions = await sql`
        SELECT session_id, workspace_id, question, intent, query_plan,
               follow_up_questions, is_favorite, created_at
        FROM nlquery_sessions
        WHERE session_id = ${sessionId} AND workspace_id = ${workspaceId}
      ` as SessionRow[];

      if (sessions.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
      }

      const feedback = await sql`
        SELECT session_id, helpful, notes, created_at
        FROM nlquery_feedback
        WHERE session_id = ${sessionId}
      ` as FeedbackRow[];

      return c.json({
        data: {
          ...sessionToResponse(sessions[0]!),
          feedback: feedback.length > 0 ? {
            helpful: feedback[0]!.helpful,
            notes: feedback[0]!.notes,
            createdAt: feedback[0]!.created_at,
          } : null,
        },
      });
    } catch {
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch session' } }, 500);
    }
  });

  // POST /sessions/:id/favorite — bookmark session
  app.post('/sessions/:id/favorite', async (c) => {
    const sessionId = c.req.param('id');
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';

    try {
      const rows = await sql`
        UPDATE nlquery_sessions
        SET is_favorite = true
        WHERE session_id = ${sessionId} AND workspace_id = ${workspaceId}
        RETURNING session_id, is_favorite
      ` as Array<{ session_id: string; is_favorite: boolean }>;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
      }

      return c.json({ data: { sessionId: rows[0]!.session_id, isFavorite: rows[0]!.is_favorite } });
    } catch {
      return c.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to bookmark session' } }, 500);
    }
  });

  // DELETE /sessions/:id/question/:qid — remove a specific question from follow-ups
  app.delete('/sessions/:id/question/:qid', async (c) => {
    const sessionId = c.req.param('id');
    const questionIndex = parseInt(c.req.param('qid'), 10);
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';

    if (isNaN(questionIndex)) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'qid must be a number' } }, 400);
    }

    try {
      const sessions = await sql`
        SELECT session_id, follow_up_questions
        FROM nlquery_sessions
        WHERE session_id = ${sessionId} AND workspace_id = ${workspaceId}
      ` as Array<{ session_id: string; follow_up_questions: string[] }>;

      if (sessions.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
      }

      const questions = sessions[0]!.follow_up_questions;
      if (questionIndex < 0 || questionIndex >= questions.length) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Question index out of range' } }, 404);
      }

      const updated = questions.filter((_, i) => i !== questionIndex);
      await sql`
        UPDATE nlquery_sessions
        SET follow_up_questions = ${JSON.stringify(updated)}::jsonb
        WHERE session_id = ${sessionId}
      `;

      return c.json({ data: { sessionId, removedIndex: questionIndex, remainingCount: updated.length } });
    } catch {
      return c.json({ error: { code: 'DELETE_FAILED', message: 'Failed to remove question' } }, 500);
    }
  });

  return app;
}

function sessionToResponse(row: SessionRow) {
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    question: row.question,
    intent: row.intent,
    queryPlan: row.query_plan,
    followUpQuestions: row.follow_up_questions,
    isFavorite: row.is_favorite,
    createdAt: row.created_at,
  };
}
