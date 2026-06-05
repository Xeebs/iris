import type { SemanticEntity } from '@iris/connector-sdk';

import { dedup } from './stages/dedup.js';
import { truncate, estimateEntityTokens } from './stages/truncate.js';
import { serialize } from './stages/serialize.js';

export interface CompressionOptions {
  /** Maximum tokens to return. Default: 2000 */
  contextBudget: number;
  /** The original query (reserved for future relevance scoring). */
  query: string;
}

export interface CompressedContext {
  content: string;
  tokenCount: number;
  entityCount: number;
  truncated: boolean;
  savedTokens: number;
}

export const DEFAULT_COMPRESSION_OPTIONS: CompressionOptions = {
  contextBudget: 2000,
  query: '',
};

/**
 * Run the full compression pipeline on a set of semantic entities.
 *
 * Stages (in order):
 * 1. Dedup by ID — remove exact-ID duplicates, keep first occurrence
 * 2. Truncate — drop entities that would exceed contextBudget
 * 3. Serialize — render to compact token-efficient text
 *
 * @param entities - Raw entities from the retrieval engine (ranked best-first)
 * @param options  - Compression options overrides
 * @returns Compressed context ready for LLM delivery
 */
export function compress(
  entities: SemanticEntity[],
  options: Partial<CompressionOptions> = {},
): CompressedContext {
  const opts = { ...DEFAULT_COMPRESSION_OPTIONS, ...options };

  const deduped = dedup(entities);
  const fitted = truncate(deduped, opts.contextBudget);
  const content = serialize(fitted);

  const tokenCount = Math.ceil(content.length / 4);
  const savedTokens =
    fitted.length < deduped.length
      ? deduped.slice(fitted.length).reduce((acc, e) => acc + estimateEntityTokens(e), 0)
      : 0;

  return {
    content,
    tokenCount,
    entityCount: fitted.length,
    truncated: fitted.length < deduped.length,
    savedTokens,
  };
}

/**
 * Async alias for callers that expect a Promise (e.g. MCP tool layer).
 *
 * @param entities - Raw entities from the retrieval engine
 * @param options  - Compression options overrides
 * @returns Compressed context ready for LLM delivery
 */
export async function compressContext(
  entities: SemanticEntity[],
  options: Partial<CompressionOptions> = {},
): Promise<CompressedContext> {
  return compress(entities, options);
}
