import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'nlp-config-engine' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Intent Types ─────────────────────────────────────────────────────────────

export type IntentCategory = 'temporal' | 'retention' | 'access_control' | 'entity_merging';

export type TemporalPayload = {
  fiscalYearStartMonth?: number;
  fiscalYearStartDay?: number;
  quarters?: [number, number][];
  timezone?: string;
};

export type RetentionPayload = {
  archiveAfterDays?: number;
  deleteAfterDays?: number;
  entityType?: string;
};

export type AccessControlPayload = {
  action: 'mask' | 'hide' | 'restrict';
  field: string;
  scope: string;
};

export type EntityMergingPayload = {
  sourceType: string;
  targetType: string;
  reason?: string;
};

export type IntentPayload =
  | TemporalPayload
  | RetentionPayload
  | AccessControlPayload
  | EntityMergingPayload;

export type ParsedIntent = {
  category: IntentCategory;
  payload: IntentPayload;
  summary: string;
  confidence: number;
  rawInput: string;
};

export type ConfigDiff = {
  category: IntentCategory;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  explanation: string;
};

export type NlpIntent = {
  id: string;
  workspaceId: string;
  category: IntentCategory;
  naturalText: string;
  interpretedConfigJson: IntentPayload;
  confirmedByUserId: string | null;
  appliedAt: Date | null;
  createdAt: Date;
};

// ─── Rule-Based Parser ────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseMonthRef(text: string): number | null {
  const lower = text.toLowerCase().trim();
  if (MONTH_MAP[lower]) return MONTH_MAP[lower]!;
  const n = parseInt(lower, 10);
  return n >= 1 && n <= 12 ? n : null;
}

function parseDayCount(text: string): number | null {
  const m = /(\d+)\s*(day|week|month|year)/i.exec(text);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  switch (m[2]!.toLowerCase()) {
    case 'week': return n * 7;
    case 'month': return n * 30;
    case 'year': return n * 365;
    default: return n;
  }
}

/**
 * Parse a natural language configuration intent using rule-based matching.
 * Falls back to a generic 'custom' handling for unrecognized inputs.
 *
 * @param text - Natural language configuration statement
 * @returns Parsed intent or an error if the input cannot be interpreted
 */
export function parseConfigIntent(text: string): Result<ParsedIntent, Error> {
  const lower = text.toLowerCase();

  // ── Temporal: fiscal year ────────────────────────────────────────────────
  const fiscalMatch = /fiscal\s+year\s+starts?\s+in\s+(\w+)/i.exec(text);
  if (fiscalMatch) {
    const month = parseMonthRef(fiscalMatch[1]!);
    if (!month) return err(new Error(`Could not parse month: "${fiscalMatch[1]}"`));
    return ok({
      category: 'temporal',
      payload: { fiscalYearStartMonth: month, fiscalYearStartDay: 1 },
      summary: `Fiscal year set to start on ${new Date(2000, month - 1, 1).toLocaleString('default', { month: 'long' })} 1st`,
      confidence: 0.95,
      rawInput: text,
    });
  }

  // ── Retention: archive/delete data older than X ──────────────────────────
  const retainMatch = /(?:archive|delete|remove|purge)\s+(?:data|entities|records|contacts)?\s*older\s+than\s+([\w\s]+)/i.exec(text);
  if (retainMatch) {
    const days = parseDayCount(retainMatch[1]!);
    if (!days) return err(new Error(`Could not parse time period: "${retainMatch[1]}"`));
    const isDelete = /delete|remove|purge/i.test(text);
    const entityTypeMatch = /(contacts?|deals?|companies?|accounts?|leads?)/i.exec(text);
    return ok({
      category: 'retention',
      payload: {
        [isDelete ? 'deleteAfterDays' : 'archiveAfterDays']: days,
        entityType: entityTypeMatch?.[1]?.toLowerCase() ?? undefined,
      },
      summary: `${isDelete ? 'Delete' : 'Archive'} ${entityTypeMatch?.[1] ?? 'entities'} older than ${retainMatch[1].trim()}`,
      confidence: 0.9,
      rawInput: text,
    });
  }

  // ── Access control: hide/mask field from role ─────────────────────────────
  const accessMatch = /(?:hide|mask|restrict)\s+([\w\s]+?)\s+(?:from|for)\s+([\w\s]+)/i.exec(text);
  if (accessMatch) {
    const field = accessMatch[1]!.trim().replace(/\s+/g, '_');
    const scope = accessMatch[2]!.trim();
    const action = /hide/i.test(text) ? 'hide' : /restrict/i.test(text) ? 'restrict' : 'mask';
    return ok({
      category: 'access_control',
      payload: { action, field, scope },
      summary: `${action.charAt(0).toUpperCase() + action.slice(1)} field "${field}" for "${scope}"`,
      confidence: 0.88,
      rawInput: text,
    });
  }

  // ── Entity merging: "X and Y are the same" ────────────────────────────────
  const mergeMatch = /(\w+)\s+and\s+(\w+)\s+are\s+the\s+same/i.exec(text);
  if (mergeMatch) {
    return ok({
      category: 'entity_merging',
      payload: { sourceType: mergeMatch[1]!.toLowerCase(), targetType: mergeMatch[2]!.toLowerCase(), reason: text },
      summary: `Treat "${mergeMatch[1]}" and "${mergeMatch[2]}" as the same entity type`,
      confidence: 0.87,
      rawInput: text,
    });
  }

  // ── Timezone ─────────────────────────────────────────────────────────────
  const tzMatch = /(?:timezone|time\s+zone)\s+is\s+([\w/]+)/i.exec(text);
  if (tzMatch) {
    return ok({
      category: 'temporal',
      payload: { timezone: tzMatch[1] },
      summary: `Workspace timezone set to ${tzMatch[1]}`,
      confidence: 0.93,
      rawInput: text,
    });
  }

  return err(new Error(`Could not parse intent from: "${text}". Supported: fiscal year, retention rules, access control, entity merging.`));
}

/**
 * Generate a human-readable diff showing what would change if this intent is applied.
 *
 * @param intent - Parsed intent to preview
 * @returns Config diff with before/after and explanation
 */
export function generateConfigDiff(intent: ParsedIntent): ConfigDiff {
  const explanations: Record<IntentCategory, string> = {
    temporal: 'Updates workspace temporal settings. Affects how date ranges and fiscal periods are interpreted in queries.',
    retention: 'Updates data retention policy. Entities older than the threshold will be scheduled for archival/deletion.',
    access_control: 'Updates field-level access control. Affected users will no longer see the masked/hidden field.',
    entity_merging: 'Creates a deduplication rule. Entities of both types will be merged during the next sync cycle.',
  };
  return {
    category: intent.category,
    before: null,
    after: intent.payload as Record<string, unknown>,
    explanation: explanations[intent.category],
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Manages NLP-driven configuration intents for a workspace.
 * All intents require user confirmation before being applied.
 */
export class NlpConfigEngine {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Parse an intent from natural language and persist it as a pending record.
   *
   * @param workspaceId - Target workspace
   * @param text        - Natural language configuration statement
   * @returns The persisted intent record
   */
  async parseAndSave(workspaceId: string, text: string): Promise<Result<NlpIntent, Error>> {
    const intentResult = parseConfigIntent(text);
    if (intentResult.isErr()) return err(intentResult.error);
    const intent = intentResult.value;

    try {
      const rows = await this.sql<NlpIntent[]>`
        INSERT INTO nlp_intents (workspace_id, category, natural_text, interpreted_config_json)
        VALUES (${workspaceId}, ${intent.category}, ${text}, ${JSON.stringify(intent.payload)})
        RETURNING
          id,
          workspace_id AS "workspaceId",
          category,
          natural_text AS "naturalText",
          interpreted_config_json AS "interpretedConfigJson",
          confirmed_by_user_id AS "confirmedByUserId",
          applied_at AS "appliedAt",
          created_at AS "createdAt"
      `;
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no row'));
      log.info('NLP intent saved', { workspaceId, category: intent.category });
      return ok(row);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List pending intents for a workspace.
   *
   * @param workspaceId - Target workspace
   */
  async listPending(workspaceId: string): Promise<Result<NlpIntent[], Error>> {
    try {
      const rows = await this.sql<NlpIntent[]>`
        SELECT
          id,
          workspace_id AS "workspaceId",
          category,
          natural_text AS "naturalText",
          interpreted_config_json AS "interpretedConfigJson",
          confirmed_by_user_id AS "confirmedByUserId",
          applied_at AS "appliedAt",
          created_at AS "createdAt"
        FROM nlp_intents
        WHERE workspace_id = ${workspaceId} AND applied_at IS NULL
        ORDER BY created_at DESC
      `;
      return ok(rows);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Confirm and apply an intent, recording the approving user.
   *
   * @param workspaceId - Target workspace
   * @param id          - Intent record ID
   * @param userId      - ID of the confirming user
   */
  async applyIntent(workspaceId: string, id: string, userId: string): Promise<Result<NlpIntent | null, Error>> {
    try {
      const rows = await this.sql<NlpIntent[]>`
        UPDATE nlp_intents
        SET confirmed_by_user_id = ${userId}, applied_at = NOW()
        WHERE workspace_id = ${workspaceId} AND id = ${id} AND applied_at IS NULL
        RETURNING
          id,
          workspace_id AS "workspaceId",
          category,
          natural_text AS "naturalText",
          interpreted_config_json AS "interpretedConfigJson",
          confirmed_by_user_id AS "confirmedByUserId",
          applied_at AS "appliedAt",
          created_at AS "createdAt"
      `;
      const row = rows[0] ?? null;
      if (row) log.info('NLP intent applied', { workspaceId, id, category: row.category });
      return ok(row);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Dismiss (delete) a pending intent without applying it.
   *
   * @param workspaceId - Target workspace
   * @param id          - Intent record ID
   */
  async dismissIntent(workspaceId: string, id: string): Promise<Result<boolean, Error>> {
    try {
      const rows = await this.sql<{ id: string }[]>`
        DELETE FROM nlp_intents
        WHERE workspace_id = ${workspaceId} AND id = ${id} AND applied_at IS NULL
        RETURNING id
      `;
      return ok(rows.length > 0);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
