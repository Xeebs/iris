import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import OpenAI from 'openai';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'nlp-config-parser' });

const NLP_MODEL = 'gpt-4o-mini';
const MAX_INPUT_TOKENS = 500;

export type ConfigType = 'fiscal_calendar' | 'metric_definition' | 'date_interpretation' | 'custom';

export interface ParsedConfig {
  configType: ConfigType;
  /** Structured interpretation of the natural language input. */
  parsedJson: Record<string, unknown>;
  /** Human-readable summary of what was interpreted. */
  summary: string;
  /** Confidence score 0–1. Low confidence results should require human approval. */
  confidence: number;
}

export interface NlpConfigRecord {
  id: string;
  workspaceId: string;
  configType: ConfigType;
  inputText: string;
  parsedJson: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: Date | null;
  interpretedAt: Date;
  createdAt: Date;
}

type SqlClient = ReturnType<typeof postgres>;

const SYSTEM_PROMPT = `You are a business configuration interpreter for Iris, a business intelligence platform.
Your job is to parse natural language configuration statements from business users and extract structured data.

When given a configuration statement, respond with a JSON object containing:
- "configType": one of "fiscal_calendar", "metric_definition", "date_interpretation", "custom"
- "parsedJson": a structured JSON object with the extracted configuration
- "summary": a one-sentence plain English summary of what was interpreted
- "confidence": a number 0–1 indicating how confident you are in the interpretation

Examples:
- "our fiscal year starts in February" → {"configType": "fiscal_calendar", "parsedJson": {"fiscalYearStartMonth": 2, "fiscalYearStartDay": 1}, "summary": "Fiscal year starts February 1st", "confidence": 0.95}
- "ARR is MRR times 12" → {"configType": "metric_definition", "parsedJson": {"metric": "ARR", "formula": "MRR * 12", "description": "Annual Recurring Revenue calculated as 12 times Monthly Recurring Revenue"}, "summary": "ARR defined as MRR × 12", "confidence": 0.98}
- "quarters are Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec" → {"configType": "fiscal_calendar", "parsedJson": {"quarters": [[1,3],[4,6],[7,9],[10,12]]}, "summary": "Standard calendar quarters", "confidence": 0.99}

Only output valid JSON. No markdown, no explanation outside the JSON.`;

/**
 * Parse a natural language configuration statement using gpt-4o-mini.
 *
 * @param nlText - Plain English business configuration statement
 * @param openAiKey - OpenAI API key
 * @returns Result with the parsed configuration
 */
export async function parseConfigNL(
  nlText: string,
  openAiKey: string,
): Promise<Result<ParsedConfig, Error>> {
  if (nlText.length > MAX_INPUT_TOKENS * 4) {
    return err(new Error(`Input too long: ${nlText.length} chars (max ~${MAX_INPUT_TOKENS * 4})`));
  }

  const client = new OpenAI({ apiKey: openAiKey });

  try {
    const response = await client.chat.completions.create({
      model: NLP_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: nlText },
      ],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return err(new Error('Empty response from NLP model'));

    const parsed = JSON.parse(content) as {
      configType?: ConfigType;
      parsedJson?: Record<string, unknown>;
      summary?: string;
      confidence?: number;
    };

    if (!parsed.configType || !parsed.parsedJson || !parsed.summary) {
      return err(new Error('Malformed NLP response: missing required fields'));
    }

    return ok({
      configType: parsed.configType,
      parsedJson: parsed.parsedJson,
      summary: parsed.summary,
      confidence: parsed.confidence ?? 0.5,
    });
  } catch (e) {
    log.error('NLP config parse failed', { error: e });
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Service for storing and managing workspace NLP configurations.
 */
export class NlpConfigService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Save a parsed NLP config to the database with 'pending' status.
   *
   * @param workspaceId - Workspace identifier
   * @param inputText   - Original natural language input
   * @param parsed      - Result of parseConfigNL()
   */
  async saveConfig(
    workspaceId: string,
    inputText: string,
    parsed: ParsedConfig,
  ): Promise<Result<NlpConfigRecord, Error>> {
    try {
      const [row] = await this.sql<NlpConfigRecord[]>`
        INSERT INTO workspace_nlp_configs
          (workspace_id, config_type, input_text, parsed_json)
        VALUES (${workspaceId}, ${parsed.configType}, ${inputText}, ${JSON.stringify(parsed.parsedJson)})
        RETURNING
          id,
          workspace_id AS "workspaceId",
          config_type AS "configType",
          input_text AS "inputText",
          parsed_json AS "parsedJson",
          status,
          approved_by AS "approvedBy",
          approved_at AS "approvedAt",
          interpreted_at AS "interpretedAt",
          created_at AS "createdAt"
      `;
      if (!row) return err(new Error('No row returned'));
      log.info('NLP config saved', { workspaceId, configType: parsed.configType });
      return ok(row);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all NLP configs for a workspace, optionally filtered by status.
   *
   * @param workspaceId - Workspace identifier
   * @param status      - Optional status filter
   */
  async listConfigs(
    workspaceId: string,
    status?: 'pending' | 'approved' | 'rejected',
  ): Promise<Result<NlpConfigRecord[], Error>> {
    try {
      const rows = await this.sql<NlpConfigRecord[]>`
        SELECT
          id,
          workspace_id AS "workspaceId",
          config_type AS "configType",
          input_text AS "inputText",
          parsed_json AS "parsedJson",
          status,
          approved_by AS "approvedBy",
          approved_at AS "approvedAt",
          interpreted_at AS "interpretedAt",
          created_at AS "createdAt"
        FROM workspace_nlp_configs
        WHERE workspace_id = ${workspaceId}
          ${status ? this.sql`AND status = ${status}` : this.sql``}
        ORDER BY interpreted_at DESC
      `;
      return ok(rows);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Approve a pending NLP config.
   *
   * @param workspaceId - Workspace identifier
   * @param id          - Config record ID
   * @param approvedBy  - User ID of the approver
   */
  async approveConfig(
    workspaceId: string,
    id: string,
    approvedBy: string,
  ): Promise<Result<NlpConfigRecord | null, Error>> {
    try {
      const [row] = await this.sql<NlpConfigRecord[]>`
        UPDATE workspace_nlp_configs
        SET status = 'approved', approved_by = ${approvedBy}, approved_at = NOW()
        WHERE workspace_id = ${workspaceId} AND id = ${id}
        RETURNING
          id,
          workspace_id AS "workspaceId",
          config_type AS "configType",
          input_text AS "inputText",
          parsed_json AS "parsedJson",
          status,
          approved_by AS "approvedBy",
          approved_at AS "approvedAt",
          interpreted_at AS "interpretedAt",
          created_at AS "createdAt"
      `;
      return ok(row ?? null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
