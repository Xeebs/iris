import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

import { OpenAICompletionProvider } from './llm-providers/openai-completion-provider.js';
import { AnthropicProvider } from './llm-providers/anthropic-provider.js';
import { GoogleProvider } from './llm-providers/google-provider.js';
import { OllamaCompletionProvider } from './llm-providers/ollama-completion-provider.js';

export type { LlmCompletionProvider, CompletionMessage, CompletionOptions, CompletionResult } from './llm-providers/types.js';

const log = logger.child({ service: 'llm-router' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type LlmProviderId = 'openai' | 'anthropic' | 'google' | 'ollama';
export type LlmUseCase = 'completion' | 'embedding';

export type WorkspaceProviderConfig = {
  configId: string;
  workspaceId: string;
  providerId: LlmProviderId;
  modelId: string;
  apiKeyEncrypted: string;
  costPer1mTokens: number;
  defaultForUseCase: LlmUseCase | null;
  endpoint: string | null;
  createdAt: Date;
};

export type ProviderHealth = {
  providerId: LlmProviderId;
  healthy: boolean;
  latencyMs: number | null;
  error: string | null;
};

import type { LlmCompletionProvider, CompletionMessage, CompletionOptions, CompletionResult } from './llm-providers/types.js';

// ─── Token counting ────────────────────────────────────────────────────────────

/**
 * Estimates token count using character-to-token heuristic (4 chars ≈ 1 token).
 * @param text - Text to estimate
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculates cost in USD for a given token count and per-1M rate.
 * @param tokens - Number of tokens
 * @param costPer1mTokens - Cost per 1 million tokens in USD
 * @returns Cost in USD
 */
export function calculateCostUsd(tokens: number, costPer1mTokens: number): number {
  return (tokens / 1_000_000) * costPer1mTokens;
}

// ─── Provider factory ─────────────────────────────────────────────────────────

/**
 * Instantiates the correct completion provider from a workspace config.
 * @param config - Workspace provider configuration
 * @returns LlmCompletionProvider instance
 */
export function buildProvider(config: WorkspaceProviderConfig): LlmCompletionProvider {
  const apiKey = config.apiKeyEncrypted;
  switch (config.providerId) {
    case 'openai':
      return new OpenAICompletionProvider(apiKey, config.modelId);
    case 'anthropic':
      return new AnthropicProvider(apiKey, config.modelId);
    case 'google':
      return new GoogleProvider(apiKey, config.modelId);
    case 'ollama':
      return new OllamaCompletionProvider(config.endpoint ?? 'http://localhost:11434', config.modelId);
  }
}

// ─── LlmRouter class ──────────────────────────────────────────────────────────

export class LlmRouter {
  private readonly cache = new Map<string, LlmCompletionProvider>();

  constructor(private readonly sql: SqlFn) {}

  /**
   * Retrieves the configured completion provider for a workspace, falling back to OpenAI if none set.
   * @param workspaceId - Workspace identifier
   * @param useCase - Which use case to route for
   * @returns The active provider for that workspace
   */
  async route(workspaceId: string, useCase: LlmUseCase = 'completion'): Promise<Result<LlmCompletionProvider, Error>> {
    const cacheKey = `${workspaceId}:${useCase}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return ok(cached);

    try {
      const rows = await this.sql`
        SELECT config_id, workspace_id, provider_id, model_id,
               api_key_encrypted, cost_per_1m_tokens, default_for_use_case,
               endpoint, created_at
        FROM llm_provider_configs
        WHERE workspace_id = ${workspaceId}
          AND (default_for_use_case = ${useCase} OR default_for_use_case IS NULL)
        ORDER BY
          CASE WHEN default_for_use_case = ${useCase} THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT 1
      ` as unknown as {
        config_id: string; workspace_id: string; provider_id: LlmProviderId;
        model_id: string; api_key_encrypted: string; cost_per_1m_tokens: number;
        default_for_use_case: LlmUseCase | null; endpoint: string | null; created_at: string;
      }[];

      if (rows.length === 0) {
        log.warn('No provider config found, cannot route', { workspaceId, useCase });
        return err(new Error(`No LLM provider configured for workspace ${workspaceId}`));
      }

      const row = rows[0]!;
      const config: WorkspaceProviderConfig = {
        configId: row.config_id,
        workspaceId: row.workspace_id,
        providerId: row.provider_id,
        modelId: row.model_id,
        apiKeyEncrypted: row.api_key_encrypted,
        costPer1mTokens: row.cost_per_1m_tokens,
        defaultForUseCase: row.default_for_use_case,
        endpoint: row.endpoint,
        createdAt: new Date(row.created_at),
      };

      const provider = buildProvider(config);
      this.cache.set(cacheKey, provider);
      log.info('Routed to provider', { workspaceId, useCase, providerId: row.provider_id, modelId: row.model_id });
      return ok(provider);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Routes to the appropriate provider and calls complete().
   * @param messages - Conversation messages
   * @param workspaceId - Workspace identifier
   * @param options - Optional completion parameters
   * @returns Completion result with usage metadata
   */
  async complete(
    messages: CompletionMessage[],
    workspaceId: string,
    options?: CompletionOptions,
  ): Promise<Result<CompletionResult, Error>> {
    const providerResult = await this.route(workspaceId);
    if (providerResult.isErr()) return err(providerResult.error);
    return providerResult.value.complete(messages, options);
  }

  /**
   * Clears the provider cache, forcing re-read of configs from DB.
   */
  invalidateCache(workspaceId?: string): void {
    if (workspaceId) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${workspaceId}:`)) this.cache.delete(key);
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Saves a provider config for a workspace.
   * @param config - Config to register
   * @returns ID of the created config
   */
  async registerProvider(config: Omit<WorkspaceProviderConfig, 'configId' | 'createdAt'>): Promise<Result<string, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO llm_provider_configs (
          workspace_id, provider_id, model_id, api_key_encrypted,
          cost_per_1m_tokens, default_for_use_case, endpoint
        ) VALUES (
          ${config.workspaceId}, ${config.providerId}, ${config.modelId},
          ${config.apiKeyEncrypted}, ${config.costPer1mTokens},
          ${config.defaultForUseCase ?? null}, ${config.endpoint ?? null}
        )
        RETURNING config_id
      ` as unknown as { config_id: string }[];

      this.invalidateCache(config.workspaceId);
      log.info('Provider registered', { workspaceId: config.workspaceId, providerId: config.providerId });
      return ok(rows[0]!.config_id);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Removes a provider config by ID.
   * @param configId - Config to remove
   * @param workspaceId - Workspace for cache invalidation
   * @returns Result of deletion
   */
  async deregisterProvider(configId: string, workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`DELETE FROM llm_provider_configs WHERE config_id = ${configId}`;
      this.invalidateCache(workspaceId);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists all provider configs for a workspace.
   * @param workspaceId - Workspace identifier
   * @returns Array of provider configs (without decrypted API keys)
   */
  async listProviders(workspaceId: string): Promise<Result<Omit<WorkspaceProviderConfig, 'apiKeyEncrypted'>[], Error>> {
    try {
      const rows = await this.sql`
        SELECT config_id, workspace_id, provider_id, model_id,
               cost_per_1m_tokens, default_for_use_case, endpoint, created_at
        FROM llm_provider_configs
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
      ` as unknown as {
        config_id: string; workspace_id: string; provider_id: LlmProviderId;
        model_id: string; cost_per_1m_tokens: number;
        default_for_use_case: LlmUseCase | null; endpoint: string | null; created_at: string;
      }[];

      return ok(rows.map(r => ({
        configId: r.config_id,
        workspaceId: r.workspace_id,
        providerId: r.provider_id,
        modelId: r.model_id,
        costPer1mTokens: r.cost_per_1m_tokens,
        defaultForUseCase: r.default_for_use_case,
        endpoint: r.endpoint,
        createdAt: new Date(r.created_at),
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
