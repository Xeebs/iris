import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';

function formatValue(v: AttributeValue): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v instanceof Date) return v.toISOString().split('T')[0] ?? '';
  return String(v);
}

/**
 * Serialize a single entity to a compact, human-readable text block.
 * Omits null/undefined attributes and relationship internals to save tokens.
 *
 * @param entity - Entity to serialize
 * @returns Compact text block
 */
export function serializeEntity(entity: SemanticEntity): string {
  const attrs = Object.entries(entity.attributes)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `  ${k}: ${formatValue(v as AttributeValue)}`)
    .join('\n');

  const rels =
    entity.relationships.length > 0
      ? '\n  relations: ' +
        entity.relationships.map((r) => `${r.type}→${r.targetId}`).join(', ')
      : '';

  return `[${entity.type}] ${entity.label}${attrs ? '\n' + attrs : ''}${rels}`;
}

/**
 * Serialize a list of entities into a single compact context string.
 *
 * @param entities - Entities to serialize (already deduplicated and truncated)
 * @returns Joined context string ready for LLM consumption
 */
export function serialize(entities: SemanticEntity[]): string {
  return entities.map(serializeEntity).join('\n\n');
}
