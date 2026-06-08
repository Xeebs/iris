import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

import {
  getProviderSpec,
  listProviders,
  type LlmProviderId,
  type LlmProviderSpec,
  type SerializationFormat,
} from './providers/provider-registry.js';

const log = logger.child({ service: 'multi-provider-optimizer' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextChunk {
  entityId: string;
  content: string;
  tokenEstimate: number;
}

export interface OptimizedContext {
  providerId: LlmProviderId;
  serializedContext: string;
  tokenCount: number;
  truncated: boolean;
  format: SerializationFormat;
}

export interface CostEstimate {
  providerId: LlmProviderId;
  providerName: string;
  inputTokens: number;
  outputTokensEstimate: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  embeddingCostUsd: number;
  embeddingModelId: string | null;
}

export interface ProviderWorkspaceConfig {
  workspaceId: string;
  providerId: LlmProviderId;
  priority: number;
  isEnabled: boolean;
}

interface ProviderConfigRow {
  workspace_id: string;
  provider_id: string;
  priority: string;
  is_enabled: boolean;
}

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Token counting ────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN: Record<LlmProviderId, number> = {
  openai: 4,
  anthropic: 4,
  google: 4,
  ollama: 4,
  mistral: 4,
  cohere: 4,
};

/**
 * Estimates token count for a string using the provider's character-per-token ratio.
 *
 * @param text - Input text
 * @param providerId - Target LLM provider
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string, providerId: LlmProviderId): number {
  const ratio = CHARS_PER_TOKEN[providerId];
  return Math.ceil(text.length / ratio);
}

// ─── Context serialization ─────────────────────────────────────────────────────

/**
 * Serializes context chunks into the format preferred by the target provider.
 *
 * @param chunks - Context chunks to serialize
 * @param format - Target serialization format
 * @returns Serialized string
 */
export function serializeContext(chunks: ContextChunk[], format: SerializationFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(chunks.map((c) => ({ id: c.entityId, context: c.content })), null, 2);

    case 'xml': {
      const items = chunks.map(
        (c) => `  <entity id="${c.entityId}">\n    ${c.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n  </entity>`,
      );
      return `<context>\n${items.join('\n')}\n</context>`;
    }

    case 'markdown':
      return chunks.map((c) => `### ${c.entityId}\n\n${c.content}`).join('\n\n---\n\n');

    case 'plain':
    default:
      return chunks.map((c) => `[${c.entityId}] ${c.content}`).join('\n\n');
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Optimises context payloads and estimates costs for multiple LLM providers.
 */
export class MultiProviderOptimizer {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Serialises and truncates context chunks to fit within the target provider's
   * context window, using the provider's preferred serialisation format.
   *
   * @param providerId - Target provider
   * @param chunks - Raw context chunks (ordered by relevance)
   * @param contextBudgetTokens - Max tokens to use for context (default: provider context window / 4)
   * @returns OptimizedContext ready for the LLM request
   */
  optimizeContext(
    providerId: LlmProviderId,
    chunks: ContextChunk[],
    contextBudgetTokens?: number,
  ): OptimizedContext {
    const spec = getProviderSpec(providerId);
    const budget = contextBudgetTokens ?? Math.floor(spec.contextWindowTokens / 4);
    const format = spec.preferredSerializationFormat;

    let included: ContextChunk[] = [];
    let usedTokens = 0;
    let truncated = false;

    for (const chunk of chunks) {
      const chunkTokens = chunk.tokenEstimate > 0
        ? chunk.tokenEstimate
        : estimateTokenCount(chunk.content, providerId);
      if (usedTokens + chunkTokens > budget) {
        truncated = true;
        break;
      }
      included.push(chunk);
      usedTokens += chunkTokens;
    }

    const serialized = serializeContext(included, format);
    const actualTokens = estimateTokenCount(serialized, providerId);

    log.debug('Context optimized', { providerId, chunkCount: included.length, tokenCount: actualTokens, truncated });

    return {
      providerId,
      serializedContext: serialized,
      tokenCount: actualTokens,
      truncated,
      format,
    };
  }

  /**
   * Estimates the cost of a single request across all registered providers.
   *
   * @param inputTokens - Number of input tokens (context + prompt)
   * @param outputTokensEstimate - Expected output token count
   * @param embeddingTokens - Tokens for embedding at query time (default: 0)
   * @returns CostEstimate[] sorted by totalCostUsd ascending
   */
  estimateCosts(
    inputTokens: number,
    outputTokensEstimate: number,
    embeddingTokens = 0,
  ): CostEstimate[] {
    return listProviders()
      .map((spec): CostEstimate => {
        const inputCostUsd = (inputTokens / 1000) * spec.inputCostPer1kTokens;
        const outputCostUsd = (outputTokensEstimate / 1000) * spec.outputCostPer1kTokens;
        const embeddingCostUsd = spec.embeddingCostPer1kTokens != null
          ? (embeddingTokens / 1000) * spec.embeddingCostPer1kTokens
          : 0;

        return {
          providerId: spec.id,
          providerName: spec.name,
          inputTokens,
          outputTokensEstimate,
          inputCostUsd: parseFloat(inputCostUsd.toFixed(6)),
          outputCostUsd: parseFloat(outputCostUsd.toFixed(6)),
          totalCostUsd: parseFloat((inputCostUsd + outputCostUsd + embeddingCostUsd).toFixed(6)),
          embeddingCostUsd: parseFloat(embeddingCostUsd.toFixed(6)),
          embeddingModelId: spec.embeddingModelId,
        };
      })
      .sort((a, b) => a.totalCostUsd - b.totalCostUsd);
  }

  /**
   * Selects the best provider for a workspace given priority config and context size.
   *
   * @param workspaceId - Workspace to look up configs for
   * @param requiredContextTokens - Tokens needed for the context
   * @returns Spec of the best provider, or OpenAI as fallback
   */
  async selectProvider(workspaceId: string, requiredContextTokens: number): Promise<Result<LlmProviderSpec, Error>> {
    try {
      const rows = await this.sql`
        SELECT workspace_id, provider_id, priority::TEXT, is_enabled
        FROM workspace_provider_configs
        WHERE workspace_id = ${workspaceId}
          AND is_enabled = TRUE
        ORDER BY priority ASC
      ` as ProviderConfigRow[];

      for (const row of rows) {
        const id = row.provider_id as LlmProviderId;
        const spec = getProviderSpec(id);
        if (spec && spec.contextWindowTokens >= requiredContextTokens) {
          log.info('Provider selected', { workspaceId, providerId: id, requiredContextTokens });
          return ok(spec);
        }
      }

      // Fallback to OpenAI
      return ok(getProviderSpec('openai'));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Saves a provider configuration for a workspace.
   *
   * @param workspaceId - Target workspace
   * @param providerId - Provider to configure
   * @param priority - Lower = higher priority (1 = first choice)
   * @param isEnabled - Whether this provider is active
   */
  async saveProviderConfig(
    workspaceId: string,
    providerId: LlmProviderId,
    priority: number,
    isEnabled: boolean,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO workspace_provider_configs (workspace_id, provider_id, priority, is_enabled)
        VALUES (${workspaceId}, ${providerId}, ${priority}, ${isEnabled})
        ON CONFLICT (workspace_id, provider_id) DO UPDATE
          SET priority = EXCLUDED.priority,
              is_enabled = EXCLUDED.is_enabled,
              updated_at = NOW()
      `;
      log.info('Provider config saved', { workspaceId, providerId, priority, isEnabled });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists all provider configs for a workspace.
   *
   * @param workspaceId - Target workspace
   */
  async listWorkspaceProviders(workspaceId: string): Promise<Result<ProviderWorkspaceConfig[], Error>> {
    try {
      const rows = await this.sql`
        SELECT workspace_id, provider_id, priority::TEXT, is_enabled
        FROM workspace_provider_configs
        WHERE workspace_id = ${workspaceId}
        ORDER BY priority ASC
      ` as ProviderConfigRow[];

      return ok(rows.map((r) => ({
        workspaceId: r.workspace_id,
        providerId: r.provider_id as LlmProviderId,
        priority: parseInt(r.priority, 10),
        isEnabled: r.is_enabled,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
