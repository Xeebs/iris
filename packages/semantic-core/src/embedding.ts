import { AzureOpenAI } from 'openai';
import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';

import type { EmbeddingProvider } from './embedding-provider.js';

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
  model?: EmbeddingModel;
  piiFields?: Set<string>;
  /** Optionally supply an EmbeddingProvider to override the default Azure OpenAI path. */
  provider?: EmbeddingProvider;
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
  const inputs = entities.map((e) => buildEmbeddingInput(e, piiFields));

  if (options.provider) {
    const start = Date.now();
    const vectors = await options.provider.batchEmbeddings(inputs);
    log.info('Embedding batch complete (provider)', {
      provider: options.provider.getModelId(),
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
