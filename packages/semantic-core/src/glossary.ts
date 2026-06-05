import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'glossary' });

export interface GlossaryTerm {
  id: string;
  workspaceId: string;
  term: string;
  definition: string;
  exampleValue: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const termRow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  term: z.string(),
  definition: z.string(),
  example_value: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

type SqlClient = ReturnType<typeof postgres>;

function toGlossaryTerm(row: z.infer<typeof termRow>): GlossaryTerm {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    term: row.term,
    definition: row.definition,
    exampleValue: row.example_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GlossaryService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Add or update a glossary term for a workspace.
   * @param workspaceId - Workspace identifier
   * @param term - Business term (unique per workspace)
   * @param definition - Plain-English definition
   * @param exampleValue - Optional example value
   * @returns Result with the created/updated term
   */
  async addTerm(
    workspaceId: string,
    term: string,
    definition: string,
    exampleValue?: string,
  ): Promise<Result<GlossaryTerm, Error>> {
    try {
      const [row] = await this.sql<z.infer<typeof termRow>[]>`
        INSERT INTO glossary_terms (workspace_id, term, definition, example_value)
        VALUES (${workspaceId}, ${term}, ${definition}, ${exampleValue ?? null})
        ON CONFLICT (workspace_id, term) DO UPDATE
          SET definition   = EXCLUDED.definition,
              example_value = EXCLUDED.example_value,
              updated_at    = NOW()
        RETURNING *
      `;
      if (!row) return err(new Error('No row returned from INSERT'));
      log.info('Glossary term added', { workspaceId, term });
      return ok(toGlossaryTerm(row));
    } catch (e) {
      log.error('Failed to add glossary term', { workspaceId, term, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve a single glossary term.
   * @param workspaceId - Workspace identifier
   * @param term - Term to look up
   * @returns Result with the term or null if not found
   */
  async getTerm(
    workspaceId: string,
    term: string,
  ): Promise<Result<GlossaryTerm | null, Error>> {
    try {
      const [row] = await this.sql<z.infer<typeof termRow>[]>`
        SELECT * FROM glossary_terms
        WHERE workspace_id = ${workspaceId} AND term = ${term}
      `;
      return ok(row ? toGlossaryTerm(row) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all glossary terms for a workspace, with optional prefix filter.
   * @param workspaceId - Workspace identifier
   * @param filter - Optional term prefix filter
   * @returns Result with array of terms
   */
  async listTerms(
    workspaceId: string,
    filter?: string,
  ): Promise<Result<GlossaryTerm[], Error>> {
    try {
      const rows = filter
        ? await this.sql<z.infer<typeof termRow>[]>`
            SELECT * FROM glossary_terms
            WHERE workspace_id = ${workspaceId}
              AND term ILIKE ${'%' + filter + '%'}
            ORDER BY term ASC
          `
        : await this.sql<z.infer<typeof termRow>[]>`
            SELECT * FROM glossary_terms
            WHERE workspace_id = ${workspaceId}
            ORDER BY term ASC
          `;
      return ok(rows.map(toGlossaryTerm));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a glossary term.
   * @param workspaceId - Workspace identifier
   * @param term - Term to delete
   * @returns Result with true if deleted, false if not found
   */
  async deleteTerm(
    workspaceId: string,
    term: string,
  ): Promise<Result<boolean, Error>> {
    try {
      const result = await this.sql`
        DELETE FROM glossary_terms
        WHERE workspace_id = ${workspaceId} AND term = ${term}
      `;
      const deleted = result.count > 0;
      if (deleted) log.info('Glossary term deleted', { workspaceId, term });
      return ok(deleted);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
