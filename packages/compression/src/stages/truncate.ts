import type { SemanticEntity } from '@iris/connector-sdk';

import { serializeEntity } from './serialize.js';

/** Rough estimate: 4 characters per token (GPT-family heuristic). */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the token cost of a single entity when serialized.
 *
 * @param entity - Entity to estimate
 * @returns Estimated token count
 */
export function estimateEntityTokens(entity: SemanticEntity): number {
  return Math.ceil(serializeEntity(entity).length / CHARS_PER_TOKEN);
}

/**
 * Truncate a ranked list of entities to fit within a token budget.
 * Tracks character counts directly (including `\n\n` separators) so that the
 * serialized output's token count stays within the budget.
 *
 * @param entities - Ranked entities (best first)
 * @param budget   - Maximum token budget
 * @returns Entities that fit within the budget
 */
export function truncate(entities: SemanticEntity[], budget: number): SemanticEntity[] {
  const budgetChars = budget * CHARS_PER_TOKEN;
  const result: SemanticEntity[] = [];
  let usedChars = 0;

  for (const entity of entities) {
    const entityChars = serializeEntity(entity).length;
    const separatorChars = result.length > 0 ? 2 : 0; // '\n\n' between entities
    if (usedChars + separatorChars + entityChars > budgetChars) break;
    result.push(entity);
    usedChars += separatorChars + entityChars;
  }

  return result;
}
