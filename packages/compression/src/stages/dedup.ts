import type { SemanticEntity } from '@iris/connector-sdk';

/**
 * Remove duplicate entities by ID, keeping the first occurrence.
 *
 * @param entities - Input entities, potentially with duplicate IDs
 * @returns Deduplicated list preserving original order
 */
export function dedup(entities: SemanticEntity[]): SemanticEntity[] {
  const seen = new Set<string>();
  const result: SemanticEntity[] = [];
  for (const entity of entities) {
    if (!seen.has(entity.id)) {
      seen.add(entity.id);
      result.push(entity);
    }
  }
  return result;
}
