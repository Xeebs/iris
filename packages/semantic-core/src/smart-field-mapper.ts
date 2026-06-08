import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'smart-field-mapper' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';

export type SourceField = {
  name: string;
  type: FieldType;
  sampleValues?: unknown[];
  description?: string;
};

export type MappingTarget = {
  fieldName: string;
  entityAttribute: string;
  description?: string;
  expectedType: FieldType;
};

export type TransformationType = 'direct' | 'aggregate' | 'compute' | 'lookup';

export type FieldMappingSuggestion = {
  sourceField: string;
  targetAttribute: string;
  targetEntityType: string;
  confidenceScore: number;
  transformationType: TransformationType;
  transformationLogic: string;
  reasoning: string;
};

export type LearnedMapping = {
  sourceConnectorId: string;
  sourceFieldName: string;
  targetFieldName: string;
  targetEntityType: string;
  mappingCount: number;
  userConfirmedCount: number;
  confidenceScore: number;
};

export type MappingValidationResult = {
  valid: boolean;
  warnings: string[];
  errors: string[];
};

export type GeneratedMappingCode = {
  functionName: string;
  code: string;
  inputType: string;
  outputType: string;
};

/** Well-known field name aliases for semantic matching. */
const FIELD_ALIASES: Record<string, string[]> = {
  label: ['name', 'full_name', 'fullname', 'title', 'display_name', 'displayname'],
  email: ['email_address', 'emailaddress', 'contact_email', 'user_email'],
  company: ['company_name', 'organization', 'account_name', 'employer'],
  phone: ['phone_number', 'mobile', 'telephone', 'contact_phone'],
  owner: ['assigned_to', 'assignee', 'owner_id', 'rep', 'responsible'],
  stage: ['status', 'lifecycle_stage', 'deal_stage', 'pipeline_stage'],
  amount: ['value', 'deal_value', 'revenue', 'price', 'total'],
  createdAt: ['created_at', 'create_date', 'date_created', 'inserted_at'],
  lastModified: ['updated_at', 'last_modified', 'modify_date', 'changed_at'],
};

/**
 * Check if two field names are semantically equivalent via alias matching.
 * @param sourceField - Source field name
 * @param targetField - Target attribute name
 */
export function areSemanticAliases(sourceField: string, targetField: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, '');
  const sn = norm(sourceField);
  const tn = norm(targetField);
  if (sn === tn) return true;

  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    const allNames = [canonical, ...aliases].map(norm);
    if (allNames.includes(sn) && allNames.includes(tn)) return true;
  }
  return false;
}

/**
 * Detect the most likely transformation type between source and target fields.
 * @param sourceField - Source field name
 * @param targetField - Target attribute name
 * @param sourceType - Source field type
 * @param targetType - Expected target type
 */
export function detectTransformationType(
  sourceField: string,
  targetField: string,
  sourceType: FieldType,
  targetType: FieldType,
): { transformationType: TransformationType; transformationLogic: string } {
  const sn = sourceField.toLowerCase();
  const tn = targetField.toLowerCase();

  // Lookup (foreign key) — check before same-type so owner_id → owner gets correct treatment
  if (sn.endsWith('_id') || (sn.endsWith('id') && sn.length > 2)) {
    return { transformationType: 'lookup', transformationLogic: `entity.${tn} = await resolveEntity(source.${sn})` };
  }

  // Direct mapping: same type or trivially compatible
  if (sourceType === targetType || (sourceType === 'string' && targetType === 'string')) {
    return { transformationType: 'direct', transformationLogic: `entity.${tn} = source.${sn}` };
  }

  // Date string to date object
  if (sourceType === 'string' && targetType === 'date') {
    return { transformationType: 'compute', transformationLogic: `entity.${tn} = new Date(source.${sn})` };
  }

  // Number coercion from string
  if (sourceType === 'string' && targetType === 'number') {
    return { transformationType: 'compute', transformationLogic: `entity.${tn} = parseFloat(source.${sn}) || 0` };
  }

  // Boolean coercion
  if (targetType === 'boolean') {
    return { transformationType: 'compute', transformationLogic: `entity.${tn} = Boolean(source.${sn})` };
  }

  // Array construction from string (CSV)
  if (sourceType === 'string' && targetType === 'array') {
    return { transformationType: 'compute', transformationLogic: `entity.${tn} = source.${sn}.split(',').map(s => s.trim())` };
  }

  return { transformationType: 'direct', transformationLogic: `entity.${tn} = String(source.${sn})` };
}

/**
 * Compute a confidence score for a field mapping suggestion.
 * @param sourceField - Source field name
 * @param targetAttribute - Target attribute name
 * @param sourceType - Source field type
 * @param targetType - Expected type
 * @param learnedCount - Number of times this mapping was learned/confirmed
 */
export function computeMappingConfidence(
  sourceField: string,
  targetAttribute: string,
  sourceType: FieldType,
  targetType: FieldType,
  learnedCount = 0,
): number {
  let score = 0;

  // Exact name match
  if (sourceField.toLowerCase() === targetAttribute.toLowerCase()) score += 0.4;
  // Semantic alias match
  else if (areSemanticAliases(sourceField, targetAttribute)) score += 0.3;
  // Partial name overlap
  else {
    const sn = sourceField.toLowerCase().replace(/[_-]/g, '');
    const tn = targetAttribute.toLowerCase().replace(/[_-]/g, '');
    if (sn.includes(tn) || tn.includes(sn)) score += 0.15;
  }

  // Type compatibility
  if (sourceType === targetType) score += 0.3;
  else if (sourceType === 'string') score += 0.15; // string is coercible

  // Historical confirmation bonus
  score += Math.min(0.3, learnedCount * 0.05);

  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Suggest entity attribute mappings for a connector's source fields.
 * @param sourceFields - Fields from the connector's source schema
 * @param targetEntityType - Target Iris entity type
 * @param learnedMappings - Previously confirmed mappings to boost confidence
 */
export function suggestEntityMapping(
  sourceFields: SourceField[],
  targetEntityType: string,
  learnedMappings: LearnedMapping[] = [],
): FieldMappingSuggestion[] {
  const TARGET_ATTRIBUTES: Record<string, MappingTarget[]> = {
    contact: [
      { fieldName: 'label', entityAttribute: 'label', expectedType: 'string', description: 'Display name' },
      { fieldName: 'email', entityAttribute: 'email', expectedType: 'string', description: 'Email address' },
      { fieldName: 'company', entityAttribute: 'company', expectedType: 'string', description: 'Company name' },
      { fieldName: 'stage', entityAttribute: 'stage', expectedType: 'string', description: 'Lifecycle stage' },
      { fieldName: 'owner', entityAttribute: 'owner', expectedType: 'string', description: 'Owner/assignee' },
    ],
    deal: [
      { fieldName: 'label', entityAttribute: 'label', expectedType: 'string', description: 'Deal name' },
      { fieldName: 'amount', entityAttribute: 'amount', expectedType: 'number', description: 'Deal value' },
      { fieldName: 'stage', entityAttribute: 'stage', expectedType: 'string', description: 'Deal stage' },
      { fieldName: 'owner', entityAttribute: 'owner', expectedType: 'string', description: 'Deal owner' },
    ],
    company: [
      { fieldName: 'label', entityAttribute: 'label', expectedType: 'string', description: 'Company name' },
      { fieldName: 'industry', entityAttribute: 'industry', expectedType: 'string', description: 'Industry' },
      { fieldName: 'owner', entityAttribute: 'owner', expectedType: 'string', description: 'Account owner' },
    ],
  };

  const targets = TARGET_ATTRIBUTES[targetEntityType] ?? [];
  const suggestions: FieldMappingSuggestion[] = [];

  for (const sourceField of sourceFields) {
    let bestTarget: MappingTarget | null = null;
    let bestScore = 0;

    for (const target of targets) {
      const learnedCount = learnedMappings.filter(
        m => m.sourceFieldName === sourceField.name && m.targetFieldName === target.entityAttribute,
      ).reduce((sum, m) => sum + m.userConfirmedCount, 0);

      const score = computeMappingConfidence(sourceField.name, target.fieldName, sourceField.type, target.expectedType, learnedCount);
      if (score > bestScore) { bestScore = score; bestTarget = target; }
    }

    if (bestTarget && bestScore >= 0.25) {
      const { transformationType, transformationLogic } = detectTransformationType(
        sourceField.name, bestTarget.entityAttribute, sourceField.type, bestTarget.expectedType,
      );
      suggestions.push({
        sourceField: sourceField.name,
        targetAttribute: bestTarget.entityAttribute,
        targetEntityType,
        confidenceScore: bestScore,
        transformationType,
        transformationLogic,
        reasoning: `Name similarity + type compatibility (score: ${bestScore})`,
      });
    }
  }

  return suggestions.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

/**
 * Validate a mapping for data integrity risks.
 * @param suggestion - Mapping to validate
 * @param allSuggestions - All suggestions (to detect many-to-one conflicts)
 */
export function validateMappingLogic(
  suggestion: FieldMappingSuggestion,
  allSuggestions: FieldMappingSuggestion[],
): MappingValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Many-to-one: multiple source fields mapped to same target
  const conflicts = allSuggestions.filter(
    s => s.targetAttribute === suggestion.targetAttribute && s.sourceField !== suggestion.sourceField,
  );
  if (conflicts.length > 0) {
    warnings.push(`Multiple source fields map to ${suggestion.targetAttribute}: ${conflicts.map(c => c.sourceField).join(', ')}`);
  }

  // Lookup transformations may fail at runtime
  if (suggestion.transformationType === 'lookup') {
    warnings.push('Lookup transformation requires entity resolution — may be slow or fail for unknown IDs');
  }

  // Low confidence suggestions are risky
  if (suggestion.confidenceScore < 0.4) {
    warnings.push(`Low confidence mapping (${suggestion.confidenceScore}) — manual review recommended`);
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Generate TypeScript transformation function code for a mapping.
 * @param suggestion - Mapping suggestion to generate code for
 */
export function generateMappingCode(suggestion: FieldMappingSuggestion): GeneratedMappingCode {
  const fnName = `map${suggestion.sourceField.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+/, '')}To${suggestion.targetAttribute.charAt(0).toUpperCase() + suggestion.targetAttribute.slice(1)}`;

  const code = [
    `function ${fnName}(source: Record<string, unknown>): unknown {`,
    `  // ${suggestion.reasoning}`,
    `  // Confidence: ${(suggestion.confidenceScore * 100).toFixed(0)}%`,
    `  return ${suggestion.transformationLogic.replace(`entity.${suggestion.targetAttribute} = `, '')};`,
    `}`,
  ].join('\n');

  return {
    functionName: fnName,
    code,
    inputType: 'Record<string, unknown>',
    outputType: 'unknown',
  };
}

/**
 * Persist learned mappings from user confirmations.
 * @param sql - SQL function
 * @param connectorId - Source connector ID
 * @param confirmedMappings - Mappings the user confirmed
 */
export async function learnFieldMappings(
  sql: SqlFn,
  connectorId: string,
  confirmedMappings: Array<{ sourceField: string; targetField: string; entityType: string }>,
): Promise<Result<void, Error>> {
  try {
    for (const m of confirmedMappings) {
      await sql`
        INSERT INTO learned_mappings (
          source_connector_id, source_field_name, target_field_name,
          target_entity_type, mapping_count, user_confirmed_count, confidence_score
        ) VALUES (
          ${connectorId}, ${m.sourceField}, ${m.targetField},
          ${m.entityType}, 1, 1, 0.9
        )
        ON CONFLICT (source_connector_id, source_field_name, target_field_name, target_entity_type) DO UPDATE SET
          mapping_count = learned_mappings.mapping_count + 1,
          user_confirmed_count = learned_mappings.user_confirmed_count + 1,
          confidence_score = LEAST(1.0, learned_mappings.confidence_score + 0.05)
      `;
    }
    log.info('Field mappings learned', { connectorId, count: confirmedMappings.length });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Load learned mappings for a connector from the DB.
 * @param sql - SQL function
 * @param connectorId - Source connector ID
 */
export async function getLearnedMappings(
  sql: SqlFn,
  connectorId: string,
): Promise<Result<LearnedMapping[], Error>> {
  try {
    const rows = await sql`
      SELECT source_connector_id, source_field_name, target_field_name,
             target_entity_type, mapping_count, user_confirmed_count, confidence_score
      FROM learned_mappings
      WHERE source_connector_id = ${connectorId}
      ORDER BY confidence_score DESC, user_confirmed_count DESC
    ` as unknown as Array<{
      source_connector_id: string;
      source_field_name: string;
      target_field_name: string;
      target_entity_type: string;
      mapping_count: number;
      user_confirmed_count: number;
      confidence_score: string;
    }>;

    return ok(rows.map(r => ({
      sourceConnectorId: r.source_connector_id,
      sourceFieldName: r.source_field_name,
      targetFieldName: r.target_field_name,
      targetEntityType: r.target_entity_type,
      mappingCount: r.mapping_count,
      userConfirmedCount: r.user_confirmed_count,
      confidenceScore: parseFloat(r.confidence_score),
    })));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
