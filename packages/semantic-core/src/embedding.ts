import OpenAI from 'openai';
import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';

export const EMBEDDING_MODEL = 'text-embedding-3-small' as const;
export const EMBEDDING_DIMENSIONS = 1536;
export const MAX_INPUT_TOKENS = 8191;
export const BATCH_SIZE = 100;
export const TOKEN_WARNING_THRESHOLD = 512;

const log = logger.child({ service: 'embedding' });

/**
 * Build a semantic embedding input string from a SemanticEntity.
 * Excludes PII-flagged fields and null values.
 * Per embedding-patterns.md: "type: label. key: value; ..."
 */
export function buildEmbeddingInput(entity: SemanticEntity, piiFields: Set<string> = new Set()): string {
  const attrs = Object.entries(entity.attributes)
    .filter(([k, v]) => v !== null && !piiFields.has(k))
    .map(([k, v]) => `${k}: ${formatValue(v as NonNullable<AttributeValue>)}`)
    .join('; ');

  const input = `${entity.type}: ${entity.label}${attrs ? `. ${attrs}` : ''}`;

  const estimatedTokens = Math.ceil(input.length / 4);
  if (estimatedTokens > TOKEN_WARNING_THRESHOLD) {
    log.warn('Embedding input exceeds token warning threshold — truncating', {
      entityId: entity.id,
      estimatedTokens,
      threshold: TOKEN_WARNING_THRESHOLD,
    });
    return input.slice(0, TOKEN_WARNING_THRESHOLD * 4);
  }

  return input;
}

function formatValue(v: NonNullable<AttributeValue>): string {
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

export interface EmbeddingResult {
  entityId: string;
  vector: number[];
}

export interface EmbeddingServiceOptions {
  apiKey?: string;
  model?: typeof EMBEDDING_MODEL | 'text-embedding-3-large';
  piiFields?: Set<string>;
}

/**
 * Generate embeddings for a batch of SemanticEntity objects.
 * Calls OpenAI in batches of BATCH_SIZE (100) per embedding-patterns.md.
 *
 * @param entities - Entities to embed
 * @param options  - Model and PII config
 * @returns        - Array of {entityId, vector} in the same order as input
 */
export async function generateEmbeddings(
  entities: SemanticEntity[],
  options: EmbeddingServiceOptions = {},
): Promise<EmbeddingResult[]> {
  if (entities.length === 0) return [];

  const model = options.model ?? EMBEDDING_MODEL;
  const piiFields = options.piiFields ?? new Set<string>();
  const client = new OpenAI({ apiKey: options.apiKey ?? process.env['OPENAI_API_KEY'] });
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    const inputs = batch.map((e) => buildEmbeddingInput(e, piiFields));

    const start = Date.now();
    let response;
    try {
      response = await client.embeddings.create({ model, input: inputs });
    } catch (e) {
      throw new IndexerError(
        `Embedding API call failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }
    const latencyMs = Date.now() - start;

    const totalTokens = response.usage?.total_tokens ?? 0;
    log.info('Embedding batch complete', {
      batchIndex: Math.floor(i / BATCH_SIZE),
      batchSize: batch.length,
      totalTokens,
      latencyMs,
      model,
    });

    for (const item of response.data) {
      const entity = batch[item.index];
      if (entity) {
        results.push({ entityId: entity.id, vector: item.embedding });
      }
    }
  }

  return results;
}
