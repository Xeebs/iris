import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'schema-discovery' });

type SqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  /** postgres.js typed json parameter — required for jsonb columns (plain strings are stored as jsonb string scalars) */
  json(value: unknown): unknown;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type EntityTypeSuggestion = {
  suggestionId: string | undefined;
  connectorId: string;
  entityType: string;
  sampleCount: number;
  fields: FieldSuggestion[];
  confidence: ConfidenceLevel;
  confirmed: boolean;
  confirmedAt: Date | undefined;
};

export type FieldSuggestion = {
  fieldName: string;
  inferredType: 'string' | 'number' | 'boolean' | 'date' | 'unknown';
  nullRate: number;
  exampleValues: string[];
};

export type RelationshipSuggestion = {
  suggestionId: string | undefined;
  connectorId: string;
  fromEntityType: string;
  toEntityType: string;
  viaField: string;
  relationshipType: 'belongs_to' | 'has_many' | 'references';
  confidence: ConfidenceLevel;
  heuristic: 'fk_pattern' | 'id_suffix' | 'name_similarity';
  confirmed: boolean;
};

export type MappingReport = {
  connectorId: string;
  generatedAt: Date;
  entityTypes: EntityTypeSuggestion[];
  relationships: RelationshipSuggestion[];
  totalEntities: number;
  coverageScore: number;
};

// ─── Heuristics ───────────────────────────────────────────────────────────────

/** Detect field type from a sample of values */
function inferFieldType(values: unknown[]): FieldSuggestion['inferredType'] {
  const nonNull = values.filter(v => v !== null && v !== undefined);
  if (nonNull.length === 0) return 'unknown';
  const sample = nonNull[0];
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'number') return 'number';
  if (sample instanceof Date) return 'date';
  if (typeof sample === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(sample)) return 'date';
    return 'string';
  }
  return 'unknown';
}

/**
 * Suggest relationships between two entity types using heuristics.
 * Checks for FK patterns (toEntityType + '_id' attribute), id suffix matches, name similarity.
 *
 * @param fromType - Source entity type name
 * @param fromFields - Fields available on the source entity type
 * @param toType - Target entity type name
 * @param connectorId - Connector owning these entities
 * @returns Array of relationship suggestions (may be empty)
 */
export function suggestRelationships(
  fromType: string,
  fromFields: string[],
  toType: string,
  connectorId: string
): RelationshipSuggestion[] {
  const suggestions: RelationshipSuggestion[] = [];

  // Heuristic 1: FK pattern — exact match `<toType>_id` or `<toType>Id`
  const fkVariants = [
    `${toType}_id`,
    `${toType}Id`,
    `${toType.replace(/-/g, '_')}_id`,
  ];
  for (const fk of fkVariants) {
    if (fromFields.some(f => f.toLowerCase() === fk.toLowerCase())) {
      suggestions.push({
        suggestionId: undefined,
        connectorId,
        fromEntityType: fromType,
        toEntityType: toType,
        viaField: fk,
        relationshipType: 'belongs_to',
        confidence: 'high',
        heuristic: 'fk_pattern',
        confirmed: false,
      });
      return suggestions; // FK pattern found — no need for weaker heuristics
    }
  }

  // Heuristic 2: ID suffix — any field ending in _id or Id that starts with the toType prefix
  const idFields = fromFields.filter(f => /_id$/i.test(f) || /Id$/.test(f));
  for (const f of idFields) {
    const stem = f.replace(/_id$/i, '').replace(/Id$/, '').toLowerCase();
    if (toType.toLowerCase().includes(stem) || stem.includes(toType.toLowerCase())) {
      suggestions.push({
        suggestionId: undefined,
        connectorId,
        fromEntityType: fromType,
        toEntityType: toType,
        viaField: f,
        relationshipType: 'references',
        confidence: 'medium',
        heuristic: 'id_suffix',
        confirmed: false,
      });
      break;
    }
  }

  // Heuristic 3: Name similarity — if toType is a substring of fromType or vice versa
  if (
    suggestions.length === 0 &&
    (fromType.includes(toType) || toType.includes(fromType)) &&
    fromType !== toType
  ) {
    const longerType = fromType.length > toType.length ? fromType : toType;
    const shorterType = fromType.length <= toType.length ? fromType : toType;
    const isParent = longerType === toType; // e.g. deal_activity → deal
    suggestions.push({
      suggestionId: undefined,
      connectorId,
      fromEntityType: fromType,
      toEntityType: toType,
      viaField: `${shorterType}_id`,
      relationshipType: isParent ? 'belongs_to' : 'has_many',
      confidence: 'low',
      heuristic: 'name_similarity',
      confirmed: false,
    });
  }

  return suggestions;
}

// ─── SchemaDiscoveryEngine ────────────────────────────────────────────────────

/**
 * Analyzes existing iris_entities to discover entity types and suggest relationships
 * for a given connector. Stores suggestions in DB for human review and confirmation.
 */
export class SchemaDiscoveryEngine {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Detect entity types by inspecting existing iris_entities rows for a connector.
   * Groups by entity_type and samples attribute keys to infer field types.
   *
   * @param connectorId - Connector to analyze
   * @returns Entity type suggestions with field inference
   */
  async detectEntityTypes(connectorId: string): Promise<Result<EntityTypeSuggestion[], Error>> {
    try {
      const typeCounts = await this.sql`
        SELECT type AS entity_type, COUNT(*)::int AS sample_count
        FROM iris_entities
        WHERE source_id LIKE ${connectorId + ':%'}
        GROUP BY type
        ORDER BY sample_count DESC
      ` as { entity_type: string; sample_count: number }[];

      if (typeCounts.length === 0) {
        return ok([]);
      }

      const suggestions: EntityTypeSuggestion[] = [];

      for (const { entity_type, sample_count } of typeCounts) {
        const samples = await this.sql`
          SELECT attributes
          FROM iris_entities
          WHERE source_id LIKE ${connectorId + ':%'}
            AND type = ${entity_type}
          LIMIT 50
        ` as { attributes: Record<string, unknown> }[];

        const fieldNames = new Set<string>();
        const fieldValues: Record<string, unknown[]> = {};
        for (const s of samples) {
          for (const [k, v] of Object.entries(s.attributes)) {
            fieldNames.add(k);
            if (!fieldValues[k]) fieldValues[k] = [];
            fieldValues[k]!.push(v);
          }
        }

        const fields: FieldSuggestion[] = Array.from(fieldNames).map(fieldName => {
          const values = fieldValues[fieldName] ?? [];
          const nullCount = values.filter(v => v === null || v === undefined).length;
          const nonNull = values.filter(v => v !== null && v !== undefined);
          return {
            fieldName,
            inferredType: inferFieldType(nonNull),
            nullRate: values.length > 0 ? nullCount / values.length : 0,
            exampleValues: nonNull.slice(0, 3).map(String),
          };
        });

        const confidence: ConfidenceLevel =
          sample_count >= 100 ? 'high' : sample_count >= 10 ? 'medium' : 'low';

        suggestions.push({
          suggestionId: undefined,
          connectorId,
          entityType: entity_type,
          sampleCount: sample_count,
          fields,
          confidence,
          confirmed: false,
          confirmedAt: undefined,
        });
      }

      log.info('Entity type detection complete', { connectorId, entityTypes: suggestions.length });
      return ok(suggestions);
    } catch (e) {
      log.error('detectEntityTypes failed', { connectorId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Persist entity type suggestions to the DB and generate relationship suggestions.
   * Upserts on (connector_id, entity_type) to avoid duplicates.
   *
   * @param connectorId - Connector to run discovery for
   * @returns Full mapping report
   */
  async runDiscovery(connectorId: string): Promise<Result<MappingReport, Error>> {
    const typesResult = await this.detectEntityTypes(connectorId);
    if (typesResult.isErr()) return err(typesResult.error);

    const entityTypes = typesResult.value;
    const now = new Date();

    // Persist entity type suggestions
    for (const suggestion of entityTypes) {
      try {
        const inserted = await this.sql`
          INSERT INTO entity_type_suggestions
            (connector_id, entity_type, sample_count, fields_json, confidence, confirmed)
          VALUES
            (${connectorId}, ${suggestion.entityType}, ${suggestion.sampleCount},
             ${this.sql.json(suggestion.fields)}, ${suggestion.confidence}, false)
          ON CONFLICT (connector_id, entity_type) DO UPDATE
            SET sample_count = EXCLUDED.sample_count,
                fields_json = EXCLUDED.fields_json,
                confidence = EXCLUDED.confidence
          RETURNING suggestion_id
        ` as { suggestion_id: string }[];
        suggestion.suggestionId = inserted[0]?.suggestion_id;
      } catch (e) {
        log.warn('Failed to persist entity type suggestion', { connectorId, entityType: suggestion.entityType, error: String(e) });
      }
    }

    // Generate relationship suggestions across all entity type pairs
    const typeNames = entityTypes.map(t => t.entityType);
    const allRelationships: RelationshipSuggestion[] = [];

    for (const fromType of typeNames) {
      const fromFields = entityTypes.find(t => t.entityType === fromType)?.fields.map(f => f.fieldName) ?? [];
      for (const toType of typeNames) {
        if (fromType === toType) continue;
        const suggestions = suggestRelationships(fromType, fromFields, toType, connectorId);
        for (const rel of suggestions) {
          try {
            const inserted = await this.sql`
              INSERT INTO relationship_suggestions
                (connector_id, from_entity_type, to_entity_type, via_field,
                 relationship_type, confidence, heuristic, confirmed)
              VALUES
                (${connectorId}, ${rel.fromEntityType}, ${rel.toEntityType},
                 ${rel.viaField}, ${rel.relationshipType}, ${rel.confidence},
                 ${rel.heuristic}, false)
              ON CONFLICT (connector_id, from_entity_type, to_entity_type, via_field) DO NOTHING
              RETURNING suggestion_id
            ` as { suggestion_id: string }[];
            rel.suggestionId = inserted[0]?.suggestion_id;
          } catch (e) {
            log.warn('Failed to persist relationship suggestion', { connectorId, error: String(e) });
          }
          allRelationships.push(rel);
        }
      }
    }

    // Coverage score: ratio of entity types with at least one confirmed field
    const totalEntities = entityTypes.reduce((s, t) => s + t.sampleCount, 0);
    const typesWithFields = entityTypes.filter(t => t.fields.length > 0).length;
    const coverageScore = typeNames.length > 0 ? typesWithFields / typeNames.length : 0;

    return ok({
      connectorId,
      generatedAt: now,
      entityTypes,
      relationships: allRelationships,
      totalEntities,
      coverageScore,
    });
  }

  /**
   * List all stored suggestions (entity types and relationships) for a connector.
   *
   * @param connectorId - Connector to query
   */
  async listSuggestions(connectorId: string): Promise<Result<{
    entityTypes: EntityTypeSuggestion[];
    relationships: RelationshipSuggestion[];
  }, Error>> {
    try {
      const [etRows, relRows] = await Promise.all([
        this.sql`
          SELECT suggestion_id, connector_id, entity_type, sample_count,
                 fields_json, confidence, confirmed, confirmed_at
          FROM entity_type_suggestions
          WHERE connector_id = ${connectorId}
          ORDER BY sample_count DESC
        ` as unknown as {
          suggestion_id: string; connector_id: string; entity_type: string;
          sample_count: number; fields_json: unknown; confidence: string;
          confirmed: boolean; confirmed_at: string | null;
        }[],
        this.sql`
          SELECT suggestion_id, connector_id, from_entity_type, to_entity_type,
                 via_field, relationship_type, confidence, heuristic, confirmed
          FROM relationship_suggestions
          WHERE connector_id = ${connectorId}
          ORDER BY confidence DESC
        ` as unknown as {
          suggestion_id: string; connector_id: string; from_entity_type: string;
          to_entity_type: string; via_field: string; relationship_type: string;
          confidence: string; heuristic: string; confirmed: boolean;
        }[],
      ]);

      return ok({
        entityTypes: etRows.map(r => ({
          suggestionId: r.suggestion_id,
          connectorId: r.connector_id,
          entityType: r.entity_type,
          sampleCount: r.sample_count,
          fields: (r.fields_json as FieldSuggestion[] | null) ?? [],
          confidence: r.confidence as ConfidenceLevel,
          confirmed: r.confirmed,
          confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : undefined,
        })),
        relationships: relRows.map(r => ({
          suggestionId: r.suggestion_id,
          connectorId: r.connector_id,
          fromEntityType: r.from_entity_type,
          toEntityType: r.to_entity_type,
          viaField: r.via_field,
          relationshipType: r.relationship_type as RelationshipSuggestion['relationshipType'],
          confidence: r.confidence as ConfidenceLevel,
          heuristic: r.heuristic as RelationshipSuggestion['heuristic'],
          confirmed: r.confirmed,
        })),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Confirm a suggestion by ID — marks it confirmed in the DB.
   *
   * @param suggestionId - Suggestion to confirm
   * @param table - Which table to update ('entity_type_suggestions' | 'relationship_suggestions')
   */
  async confirmSuggestion(
    suggestionId: string,
    table: 'entity_type_suggestions' | 'relationship_suggestions'
  ): Promise<Result<void, Error>> {
    try {
      if (table === 'entity_type_suggestions') {
        await this.sql`
          UPDATE entity_type_suggestions
          SET confirmed = true, confirmed_at = now()
          WHERE suggestion_id = ${suggestionId}
        `;
      } else {
        await this.sql`
          UPDATE relationship_suggestions
          SET confirmed = true
          WHERE suggestion_id = ${suggestionId}
        `;
      }
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generate a summary mapping report from stored (not live) suggestions.
   *
   * @param connectorId - Connector to report on
   */
  async generateMappingReport(connectorId: string): Promise<Result<MappingReport, Error>> {
    const listResult = await this.listSuggestions(connectorId);
    if (listResult.isErr()) return err(listResult.error);

    const { entityTypes, relationships } = listResult.value;
    const totalEntities = entityTypes.reduce((s, t) => s + t.sampleCount, 0);
    const typesWithFields = entityTypes.filter(t => t.fields.length > 0).length;
    const coverageScore = entityTypes.length > 0 ? typesWithFields / entityTypes.length : 0;

    return ok({
      connectorId,
      generatedAt: new Date(),
      entityTypes,
      relationships,
      totalEntities,
      coverageScore,
    });
  }
}
