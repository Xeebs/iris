import { AzureOpenAI } from 'openai';
import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';

import type { EmbeddingProvider } from './embedding-provider.js';
import { createDefaultProvider } from './embedding-provider.js';

export const EMBEDDING_MODEL_SMALL = 'text-embedding-3-small' as const;
export const EMBEDDING_MODEL_LARGE = 'text-embedding-3-large' as const;
export type EmbeddingModel = typeof EMBEDDING_MODEL_SMALL | typeof EMBEDDING_MODEL_LARGE;

export const EMBEDDING_DIMENSIONS: Record<EmbeddingModel, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
};

/** @deprecated Use EMBEDDING_MODEL_SMALL */
export const EMBEDDING_MODEL = EMBEDDING_MODEL_SMALL;
/** @deprecated Use EMBEDDING_DIMENSIONS[model] */
export const EMBEDDING_DIMENSIONS_DEFAULT = 1536;

export const MAX_INPUT_TOKENS = 8191;
export const BATCH_SIZE = 100;
export const TOKEN_WARNING_THRESHOLD = 512;

const log = logger.child({ service: 'embedding' });

function resolveDeploymentName(model: EmbeddingModel): string {
  if (model === EMBEDDING_MODEL_LARGE) {
    return process.env['AZURE_OPENAI_LARGE_DEPLOYMENT'] ?? 'text-embedding-3-large';
  }
  return process.env['AZURE_OPENAI_SMALL_DEPLOYMENT'] ?? 'text-embedding-3-small';
}

function buildAzureClient(deploymentName: string): AzureOpenAI {
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  const apiKey = process.env['AZURE_OPENAI_API_KEY'];
  const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2023-05-15';

  if (!endpoint || !apiKey) {
    throw new IndexerError(
      'AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set in environment',
    );
  }

  return new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment: deploymentName });
}

/**
 * Build a semantic embedding input string from a SemanticEntity.
 * Excludes PII-flagged fields, null values, and non-discriminative attribute values.
 * Per embedding-patterns.md: "type: label. key: value; ..."
 *
 * @param entity              - Entity to embed
 * @param piiFields           - Set of attribute keys that contain PII (excluded entirely)
 * @param isDiscriminativeAttr - Optional sync predicate called with (entityType, attrKey, attrValue).
 *                               Attributes for which it returns false are omitted from the input.
 *                               Call AttributeFrequencyTracker.warmCache() before using this.
 */
export function buildEmbeddingInput(
  entity: SemanticEntity,
  piiFields: Set<string> = new Set(),
  isDiscriminativeAttr?: (entityType: string, key: string, value: string) => boolean,
): string {
  const attrs = Object.entries(entity.attributes)
    .filter(([k, v]) => {
      if (v === null || piiFields.has(k)) return false;
      if (isDiscriminativeAttr) {
        const strVal = Array.isArray(v) ? v.join(', ') : String(v);
        return isDiscriminativeAttr(entity.type, k, strVal);
      }
      return true;
    })
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
  model?: EmbeddingModel;
  piiFields?: Set<string>;
  /** Optionally supply an EmbeddingProvider to override the default Azure OpenAI path. */
  provider?: EmbeddingProvider;
  /**
   * Corpus-discriminative attribute filter (SIRA-inspired).
   * Called with (entityType, attrKey, attrValue); return false to omit the attribute from the input.
   * Warm AttributeFrequencyTracker.warmCache() before each batch for correct results.
   */
  isDiscriminativeAttr?: (entityType: string, key: string, value: string) => boolean;
  /**
   * LLM-predicted search vocabulary keyed by entity ID (SIRA offline enrichment).
   * When provided, predicted terms are appended to each entity's embedding input.
   */
  enrichedTermsMap?: Map<string, string[]>;
}

/**
 * Generate embeddings for a batch of SemanticEntity objects.
 * When a provider is supplied in options, delegates to it; otherwise falls back to Azure OpenAI.
 * Calls the API in batches of BATCH_SIZE (100) per embedding-patterns.md.
 *
 * @param entities - Entities to embed
 * @param options  - Model, PII config, and optional provider override
 * @returns        - Array of {entityId, vector} in the same order as input
 */
export async function generateEmbeddings(
  entities: SemanticEntity[],
  options: EmbeddingServiceOptions = {},
): Promise<EmbeddingResult[]> {
  if (entities.length === 0) return [];

  const piiFields = options.piiFields ?? new Set<string>();
  const { isDiscriminativeAttr, enrichedTermsMap } = options;
  const inputs = entities.map((e) => {
    const base = buildEmbeddingInput(e, piiFields, isDiscriminativeAttr);
    const extraTerms = enrichedTermsMap?.get(e.id);
    return extraTerms && extraTerms.length > 0 ? `${base} ${extraTerms.join(' ')}` : base;
  });

  // An explicitly passed provider wins; otherwise an explicit EMBEDDING_PROVIDER
  // env var selects one (callers like the sync worker don't pass providers).
  // With neither, the legacy Azure path below is unchanged.
  const provider =
    options.provider ?? (process.env['EMBEDDING_PROVIDER'] ? createDefaultProvider() : undefined);

  if (provider) {
    const start = Date.now();
    const vectors = await provider.batchEmbeddings(inputs);
    log.info('Embedding batch complete (provider)', {
      provider: provider.getModelId(),
      entityCount: entities.length,
      durationMs: Date.now() - start,
    });
    return entities.map((e, i) => ({ entityId: e.id, vector: vectors[i]! }));
  }

  // Legacy Azure OpenAI path
  const model = options.model ?? EMBEDDING_MODEL_SMALL;
  const deploymentName = resolveDeploymentName(model);
  const client = buildAzureClient(deploymentName);
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    const batchInputs = inputs.slice(i, i + BATCH_SIZE);

    const start = Date.now();
    let response;
    try {
      // Azure OpenAI: model field must match the deployment name
      response = await client.embeddings.create({ model: deploymentName, input: batchInputs });
    } catch (e) {
      throw new IndexerError(
        `Azure OpenAI embedding call failed (deployment: ${deploymentName}): ${e instanceof Error ? e.message : String(e)}`,
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
      deployment: deploymentName,
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
