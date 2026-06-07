import { createHash, createHmac } from 'crypto';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'pii-masker' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type PiiStrategy = 'redact' | 'hash' | 'tokenize';

export type PiiDetectionType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'ip_address'
  | 'custom';

export interface PiiFieldConfig {
  fieldName: string;
  strategy: PiiStrategy;
  customPattern?: string;
}

export interface WorkspacePiiConfig {
  workspaceId: string;
  enableAutoDetection: boolean;
  defaultStrategy: PiiStrategy;
  fieldConfigs: PiiFieldConfig[];
  tokenizationKey: string;
}

export interface MaskedEntity extends SemanticEntity {
  _piiMaskedFields?: string[];
}

// ─── PII Detection Patterns ───────────────────────────────────────────────────

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s\-().]{7,20}$/;
const SSN_PATTERN = /^\d{3}-?\d{2}-?\d{4}$/;
const CREDIT_CARD_PATTERN = /^(?:\d{4}[\s-]?){3}\d{4}$/;
const IP_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const PII_FIELD_NAME_HINTS = new Set([
  'email',
  'email_address',
  'phone',
  'phone_number',
  'mobile',
  'cell',
  'fax',
  'ssn',
  'social_security',
  'social_security_number',
  'tax_id',
  'tin',
  'credit_card',
  'card_number',
  'card_no',
  'cvv',
  'cvc',
  'ip',
  'ip_address',
  'date_of_birth',
  'dob',
  'birth_date',
  'address',
  'street_address',
  'postal_code',
  'zip',
  'zip_code',
  'national_id',
  'passport_number',
  'drivers_license',
  'bank_account',
  'account_number',
  'routing_number',
]);

/**
 * Detect the PII type of a value given its field name and raw value.
 * Returns null if no PII is detected.
 *
 * @param fieldName - Attribute key name (case-insensitive check against known hints)
 * @param value     - Attribute value to inspect
 */
export function detectPiiType(fieldName: string, value: unknown): PiiDetectionType | null {
  const lowerField = fieldName.toLowerCase().replace(/[\s-]/g, '_');

  if (PII_FIELD_NAME_HINTS.has(lowerField)) {
    if (lowerField === 'email' || lowerField === 'email_address') return 'email';
    if (lowerField.includes('phone') || lowerField === 'mobile' || lowerField === 'cell') return 'phone';
    if (lowerField === 'ssn' || lowerField.includes('social_security')) return 'ssn';
    if (lowerField.includes('credit_card') || lowerField.includes('card_number')) return 'credit_card';
    if (lowerField === 'ip' || lowerField === 'ip_address') return 'ip_address';
    return 'custom';
  }

  if (typeof value !== 'string') return null;

  if (EMAIL_PATTERN.test(value)) return 'email';
  if (SSN_PATTERN.test(value)) return 'ssn';
  if (CREDIT_CARD_PATTERN.test(value.replace(/\s/g, ''))) return 'credit_card';
  if (IP_PATTERN.test(value)) return 'ip_address';
  if (PHONE_PATTERN.test(value)) return 'phone';

  return null;
}

// ─── Masking Functions ────────────────────────────────────────────────────────

/**
 * Apply a masking strategy to a single value.
 *
 * - redact:   Replace with `[REDACTED]`
 * - hash:     One-way SHA-256 hex digest (first 16 chars)
 * - tokenize: Deterministic HMAC-SHA256 token using the workspace key
 *
 * @param value          - Original value (converted to string for masking)
 * @param strategy       - Which strategy to apply
 * @param tokenizationKey - Required for 'tokenize' strategy; ignored otherwise
 */
export function maskValue(
  value: unknown,
  strategy: PiiStrategy,
  tokenizationKey = 'default-key',
): string {
  const str = typeof value === 'string' ? value : String(value);

  switch (strategy) {
    case 'redact':
      return '[REDACTED]';
    case 'hash':
      return createHash('sha256').update(str).digest('hex').slice(0, 16);
    case 'tokenize':
      return 'tok_' + createHmac('sha256', tokenizationKey).update(str).digest('hex').slice(0, 12);
    default:
      return '[REDACTED]';
  }
}

// ─── Entity Masking ───────────────────────────────────────────────────────────

/**
 * Mask PII fields in a SemanticEntity according to a workspace PII configuration.
 *
 * Field configs in `config.fieldConfigs` take precedence over auto-detection.
 * Auto-detection is applied when `config.enableAutoDetection` is true and no explicit
 * field config exists for the attribute.
 *
 * The returned entity has a `_piiMaskedFields` array listing which keys were masked.
 *
 * @param entity - Entity to mask
 * @param config - Workspace PII configuration
 */
export function maskEntity(entity: SemanticEntity, config: WorkspacePiiConfig): MaskedEntity {
  const maskedFields: string[] = [];
  const configByField = new Map(config.fieldConfigs.map(fc => [fc.fieldName.toLowerCase(), fc]));
  const maskedAttributes: Record<string, SemanticEntity['attributes'][string]> = {};

  for (const [key, value] of Object.entries(entity.attributes)) {
    const lowerKey = key.toLowerCase();
    const fieldConfig = configByField.get(lowerKey);

    if (fieldConfig) {
      maskedAttributes[key] = maskValue(value, fieldConfig.strategy, config.tokenizationKey);
      maskedFields.push(key);
      continue;
    }

    if (config.enableAutoDetection) {
      const piiType = detectPiiType(key, value);
      if (piiType !== null) {
        maskedAttributes[key] = maskValue(value, config.defaultStrategy, config.tokenizationKey);
        maskedFields.push(key);
        continue;
      }
    }

    maskedAttributes[key] = value;
  }

  if (maskedFields.length > 0) {
    log.debug('Masked PII fields', { entityId: entity.id, entityType: entity.type, fieldCount: maskedFields.length });
  }

  return { ...entity, attributes: maskedAttributes, _piiMaskedFields: maskedFields };
}

/**
 * Apply PII masking to a list of entities.
 *
 * @param entities - Entities to mask
 * @param config   - Workspace PII configuration
 */
export function maskEntities(entities: SemanticEntity[], config: WorkspacePiiConfig): MaskedEntity[] {
  return entities.map(e => maskEntity(e, config));
}

// ─── Database Service ─────────────────────────────────────────────────────────

type SqlClient = ReturnType<typeof postgres>;

interface PiiConfigRow {
  id: string;
  workspace_id: string;
  enable_auto_detection: boolean;
  default_strategy: PiiStrategy;
  tokenization_key: string;
}

interface PiiFieldConfigRow {
  id: string;
  workspace_id: string;
  field_name: string;
  strategy: PiiStrategy;
  custom_pattern: string | null;
}

/**
 * Manages workspace PII configuration stored in Postgres.
 */
export class PiiConfigService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Upsert the workspace-level PII configuration.
   *
   * @param config - PII config to save
   */
  async upsertConfig(
    workspaceId: string,
    enableAutoDetection: boolean,
    defaultStrategy: PiiStrategy,
    tokenizationKey?: string,
  ): Promise<Result<void, Error>> {
    const key = tokenizationKey ?? createHash('sha256').update(workspaceId + Date.now()).digest('hex');
    try {
      await this.sql`
        INSERT INTO pii_configs (workspace_id, enable_auto_detection, default_strategy, tokenization_key)
        VALUES (${workspaceId}, ${enableAutoDetection}, ${defaultStrategy}, ${key})
        ON CONFLICT (workspace_id) DO UPDATE
          SET enable_auto_detection = EXCLUDED.enable_auto_detection,
              default_strategy      = EXCLUDED.default_strategy,
              updated_at            = NOW()
      `;
      log.info('PII config upserted', { workspaceId, enableAutoDetection, defaultStrategy });
      return ok(undefined);
    } catch (e) {
      log.error('Failed to upsert PII config', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Set or update a field-level PII override for a workspace.
   *
   * @param workspaceId   - Target workspace
   * @param fieldName     - Attribute key to configure
   * @param strategy      - Masking strategy to apply to this field
   * @param customPattern - Optional regex pattern for value detection
   */
  async upsertFieldConfig(
    workspaceId: string,
    fieldName: string,
    strategy: PiiStrategy,
    customPattern?: string,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO pii_field_configs (workspace_id, field_name, strategy, custom_pattern)
        VALUES (${workspaceId}, ${fieldName}, ${strategy}, ${customPattern ?? null})
        ON CONFLICT (workspace_id, field_name) DO UPDATE
          SET strategy       = EXCLUDED.strategy,
              custom_pattern = EXCLUDED.custom_pattern,
              updated_at     = NOW()
      `;
      log.info('PII field config upserted', { workspaceId, fieldName, strategy });
      return ok(undefined);
    } catch (e) {
      log.error('Failed to upsert PII field config', { workspaceId, fieldName, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a field-level PII override.
   *
   * @param workspaceId - Target workspace
   * @param fieldName   - Field name to remove override for
   */
  async deleteFieldConfig(workspaceId: string, fieldName: string): Promise<Result<boolean, Error>> {
    try {
      const result = await this.sql`
        DELETE FROM pii_field_configs WHERE workspace_id = ${workspaceId} AND field_name = ${fieldName}
      `;
      return ok(result.count > 0);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Load the full PII configuration for a workspace.
   * Returns null if no configuration has been set.
   *
   * @param workspaceId - Workspace to load config for
   */
  async getConfig(workspaceId: string): Promise<Result<WorkspacePiiConfig | null, Error>> {
    try {
      const [row] = await this.sql<PiiConfigRow[]>`
        SELECT id, workspace_id, enable_auto_detection, default_strategy, tokenization_key
        FROM pii_configs WHERE workspace_id = ${workspaceId}
      `;

      if (!row) return ok(null);

      const fieldRows = await this.sql<PiiFieldConfigRow[]>`
        SELECT id, workspace_id, field_name, strategy, custom_pattern
        FROM pii_field_configs WHERE workspace_id = ${workspaceId}
        ORDER BY field_name ASC
      `;

      return ok({
        workspaceId: row.workspace_id,
        enableAutoDetection: row.enable_auto_detection,
        defaultStrategy: row.default_strategy,
        tokenizationKey: row.tokenization_key,
        fieldConfigs: fieldRows.map(fr => ({
          fieldName: fr.field_name,
          strategy: fr.strategy,
          ...(fr.custom_pattern !== null ? { customPattern: fr.custom_pattern } : {}),
        })),
      });
    } catch (e) {
      log.error('Failed to get PII config', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
