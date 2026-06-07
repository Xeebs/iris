import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'glossary' });

export type TermStatus = 'pending' | 'approved' | 'rejected';

export interface GlossaryTerm {
  id: string;
  workspaceId: string;
  term: string;
  definition: string;
  exampleValue: string | null;
  status: TermStatus;
  approvedBy: string | null;
  approvedAt: Date | null;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GlossaryTermHistory {
  id: string;
  termId: string;
  workspaceId: string;
  term: string;
  definition: string;
  exampleValue: string | null;
  changedBy: string;
  changedAt: Date;
}

export interface TermUsage {
  term: string;
  usageCount: number;
}

const termRow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  term: z.string(),
  definition: z.string(),
  example_value: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  approved_by: z.string().nullable(),
  approved_at: z.date().nullable(),
  usage_count: z.number(),
  created_at: z.date(),
  updated_at: z.date(),
});

const historyRow = z.object({
  id: z.string(),
  term_id: z.string(),
  workspace_id: z.string(),
  term: z.string(),
  definition: z.string(),
  example_value: z.string().nullable(),
  changed_by: z.string(),
  changed_at: z.date(),
});

type SqlClient = ReturnType<typeof postgres>;

function toGlossaryTerm(row: z.infer<typeof termRow>): GlossaryTerm {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    term: row.term,
    definition: row.definition,
    exampleValue: row.example_value,
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHistory(row: z.infer<typeof historyRow>): GlossaryTermHistory {
  return {
    id: row.id,
    termId: row.term_id,
    workspaceId: row.workspace_id,
    term: row.term,
    definition: row.definition,
    exampleValue: row.example_value,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  };
}

export class GlossaryService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Add or update a glossary term for a workspace.
   * New terms default to 'pending' status. Updates to existing terms record a history entry.
   *
   * @param workspaceId - Workspace identifier
   * @param term - Business term (unique per workspace)
   * @param definition - Plain-English definition
   * @param exampleValue - Optional example value
   * @param changedBy - User ID or 'system' for the change author
   * @returns Result with the created/updated term
   */
  async addTerm(
    workspaceId: string,
    term: string,
    definition: string,
    exampleValue?: string,
    changedBy = 'system',
  ): Promise<Result<GlossaryTerm, Error>> {
    try {
      const [row] = await this.sql<z.infer<typeof termRow>[]>`
        INSERT INTO glossary_terms (workspace_id, term, definition, example_value)
        VALUES (${workspaceId}, ${term}, ${definition}, ${exampleValue ?? null})
        ON CONFLICT (workspace_id, term) DO UPDATE
          SET definition    = EXCLUDED.definition,
              example_value = EXCLUDED.example_value,
              updated_at    = NOW()
        RETURNING *
      `;
      if (!row) return err(new Error('No row returned from INSERT'));

      // Record history entry
      await this.sql`
        INSERT INTO glossary_term_history
          (term_id, workspace_id, term, definition, example_value, changed_by)
        VALUES (${row.id}, ${workspaceId}, ${term}, ${definition}, ${exampleValue ?? null}, ${changedBy})
      `;

      log.info('Glossary term added', { workspaceId, term });
      return ok(toGlossaryTerm(row));
    } catch (e) {
      log.error('Failed to add glossary term', { workspaceId, term, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve a single glossary term.
   *
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
   * List all glossary terms for a workspace, with optional prefix filter and status filter.
   *
   * @param workspaceId - Workspace identifier
   * @param filter - Optional term prefix filter
   * @param status - Optional status filter ('pending' | 'approved' | 'rejected')
   * @returns Result with array of terms
   */
  async listTerms(
    workspaceId: string,
    filter?: string,
    status?: TermStatus,
  ): Promise<Result<GlossaryTerm[], Error>> {
    try {
      const rows = await this.sql<z.infer<typeof termRow>[]>`
        SELECT * FROM glossary_terms
        WHERE workspace_id = ${workspaceId}
          ${filter ? this.sql`AND term ILIKE ${'%' + filter + '%'}` : this.sql``}
          ${status ? this.sql`AND status = ${status}` : this.sql``}
        ORDER BY term ASC
      `;
      return ok(rows.map(toGlossaryTerm));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a glossary term.
   *
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

  /**
   * Approve a glossary term, moving it from 'pending' to 'approved'.
   *
   * @param workspaceId - Workspace identifier
   * @param term - Term to approve
   * @param approvedBy - User ID of the approver
   * @returns Result with the updated term, or null if not found
   */
  async approveTerm(
    workspaceId: string,
    term: string,
    approvedBy: string,
  ): Promise<Result<GlossaryTerm | null, Error>> {
    try {
      const [row] = await this.sql<z.infer<typeof termRow>[]>`
        UPDATE glossary_terms
        SET status      = 'approved',
            approved_by = ${approvedBy},
            approved_at = NOW(),
            updated_at  = NOW()
        WHERE workspace_id = ${workspaceId} AND term = ${term}
        RETURNING *
      `;
      if (!row) return ok(null);
      log.info('Glossary term approved', { workspaceId, term, approvedBy });
      return ok(toGlossaryTerm(row));
    } catch (e) {
      log.error('Failed to approve glossary term', { workspaceId, term, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the full edit history for a glossary term.
   *
   * @param workspaceId - Workspace identifier
   * @param term - Term to look up
   * @returns Result with ordered history entries (newest first)
   */
  async getTermHistory(
    workspaceId: string,
    term: string,
  ): Promise<Result<GlossaryTermHistory[], Error>> {
    try {
      const rows = await this.sql<z.infer<typeof historyRow>[]>`
        SELECT h.*
        FROM glossary_term_history h
        JOIN glossary_terms t ON t.id = h.term_id
        WHERE h.workspace_id = ${workspaceId} AND t.term = ${term}
        ORDER BY h.changed_at DESC
      `;
      return ok(rows.map(toHistory));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get usage counts for all glossary terms in a workspace, ordered by usage desc.
   *
   * @param workspaceId - Workspace identifier
   * @returns Result with array of {term, usageCount} ordered by usage descending
   */
  async getTermUsage(workspaceId: string): Promise<Result<TermUsage[], Error>> {
    try {
      const rows = await this.sql<{ term: string; usage_count: number }[]>`
        SELECT term, usage_count
        FROM glossary_terms
        WHERE workspace_id = ${workspaceId}
        ORDER BY usage_count DESC, term ASC
      `;
      return ok(rows.map(r => ({ term: r.term, usageCount: r.usage_count })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Increment the usage count for a term (called by the indexer when a term is found in entities).
   *
   * @param workspaceId - Workspace identifier
   * @param term - Term whose count to increment
   */
  async incrementUsage(workspaceId: string, term: string): Promise<void> {
    try {
      await this.sql`
        UPDATE glossary_terms
        SET usage_count = usage_count + 1
        WHERE workspace_id = ${workspaceId} AND term = ${term}
      `;
    } catch (e) {
      log.warn('Failed to increment glossary usage count', { workspaceId, term, error: e });
    }
  }
}
