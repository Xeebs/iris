import type { Redis } from 'ioredis';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'prefix-cache' });

/** Default TTL for prefix blocks: 24 hours */
const DEFAULT_TTL_SECONDS = 86_400;

/** Redis key for a workspace's prefix block */
function prefixKey(workspaceId: string): string {
  return `iris:prefix:${workspaceId}`;
}

export interface PrefixBlock {
  workspaceId: string;
  content: string;
  tokenEstimate: number;
  builtAt: Date;
}

export interface WorkspaceContext {
  /** Business glossary terms: name → definition */
  glossary?: Record<string, string>;
  /** Metric definitions: name → description + unit */
  metrics?: Record<string, { description: string; unit?: string }>;
  /** Schema summaries: entity type → field summary */
  schemaSummaries?: Record<string, string>;
}

/**
 * Build a stable, deterministic prefix block string for a workspace.
 * Keys within each section are sorted to ensure determinism (critical for
 * provider prefix cache hits — the string must be byte-identical across calls).
 *
 * @param workspaceId - Workspace identifier
 * @param ctx         - Workspace-level business context
 * @returns Serialized prefix block content
 */
export function buildPrefixContent(workspaceId: string, ctx: WorkspaceContext): string {
  const sections: string[] = [`## Workspace: ${workspaceId}`];

  if (ctx.glossary && Object.keys(ctx.glossary).length > 0) {
    const terms = Object.entries(ctx.glossary)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([term, def]) => `  ${term}: ${def}`)
      .join('\n');
    sections.push(`### Glossary\n${terms}`);
  }

  if (ctx.metrics && Object.keys(ctx.metrics).length > 0) {
    const metrics = Object.entries(ctx.metrics)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, m]) => `  ${name}: ${m.description}${m.unit ? ` (${m.unit})` : ''}`)
      .join('\n');
    sections.push(`### Metrics\n${metrics}`);
  }

  if (ctx.schemaSummaries && Object.keys(ctx.schemaSummaries).length > 0) {
    const schemas = Object.entries(ctx.schemaSummaries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, summary]) => `  ${type}: ${summary}`)
      .join('\n');
    sections.push(`### Entity Types\n${schemas}`);
  }

  return sections.join('\n\n');
}

/**
 * Manages the static prefix context block for a workspace.
 * The block is stored in Redis and served as the first content in every MCP
 * response to maximise LLM provider prefix cache hits.
 */
export class PrefixCacheManager {
  private readonly ttlSeconds: number;

  /**
   * @param redis      - ioredis client (caller owns lifecycle)
   * @param ttlSeconds - Cache TTL in seconds. Default: 86400 (24 h)
   */
  constructor(
    private readonly redis: Redis,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ) {
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * Retrieve the cached prefix block for a workspace.
   * Returns null if no block has been built yet.
   *
   * @param workspaceId - Workspace scope
   */
  async get(workspaceId: string): Promise<PrefixBlock | null> {
    const raw = await this.redis.get(prefixKey(workspaceId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as PrefixBlock;
    } catch {
      return null;
    }
  }

  /**
   * Build and store a prefix block for a workspace.
   * Always replaces any existing block so context stays up-to-date.
   *
   * @param workspaceId - Workspace scope
   * @param ctx         - Workspace business context to encode
   * @returns The freshly built PrefixBlock
   */
  async set(workspaceId: string, ctx: WorkspaceContext): Promise<PrefixBlock> {
    const content = buildPrefixContent(workspaceId, ctx);
    const block: PrefixBlock = {
      workspaceId,
      content,
      tokenEstimate: Math.ceil(content.length / 4),
      builtAt: new Date(),
    };

    await this.redis.set(prefixKey(workspaceId), JSON.stringify(block), 'EX', this.ttlSeconds);

    log.info('Prefix block cached', {
      workspaceId,
      tokenEstimate: block.tokenEstimate,
      ttlSeconds: this.ttlSeconds,
    });

    return block;
  }

  /**
   * Invalidate the cached prefix block for a workspace.
   *
   * @param workspaceId - Workspace scope
   */
  async invalidate(workspaceId: string): Promise<void> {
    await this.redis.del(prefixKey(workspaceId));
    log.info('Prefix block invalidated', { workspaceId });
  }
}
