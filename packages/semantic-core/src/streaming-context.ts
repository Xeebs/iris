import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamChunkMetadata = {
  chunkIndex: number;
  moreChunks: boolean;
  totalCount: number;
  tokensInChunk: number;
};

export type StreamChunk = {
  metadata: StreamChunkMetadata;
  entities: SemanticEntity[];
};

export type StreamConfig = {
  /** Maximum tokens per chunk (default: 1500) */
  maxTokensPerChunk: number;
  /** Maximum entities per chunk regardless of tokens (default: 50) */
  maxEntitiesPerChunk: number;
};

const DEFAULT_CONFIG: StreamConfig = {
  maxTokensPerChunk: 1500,
  maxEntitiesPerChunk: 50,
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Estimate token count for an entity using a simple char/4 heuristic.
 */
export function estimateEntityTokens(entity: SemanticEntity): number {
  const text = `${entity.type} ${entity.label} ${JSON.stringify(entity.attributes)}`;
  return Math.ceil(text.length / 4);
}

/**
 * Build SSE event string from a stream chunk.
 */
export function encodeSSEEvent(chunk: StreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Build the terminal SSE event (stream complete marker).
 */
export function encodeSSEDone(): string {
  return `data: [DONE]\n\n`;
}

/**
 * Encode a stream error as an SSE event.
 */
export function encodeSSEError(message: string): string {
  return `data: ${JSON.stringify({ error: message })}\n\n`;
}

// ─── StreamingContextServer ────────────────────────────────────────────────────

/**
 * Splits a flat list of entities into token-bounded SSE chunks.
 * Yields chunks for progressive delivery to the client.
 */
export class StreamingContextServer {
  private readonly config: StreamConfig;

  /**
   * @param config - Optional tuning configuration
   */
  constructor(config: Partial<StreamConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Split entities into token-bounded chunks and yield each as a StreamChunk.
   *
   * @param entities   - Flat list of entities to stream
   * @param totalCount - Total count to report in metadata (may differ from entities.length for paginated sources)
   */
  *streamEntities(entities: SemanticEntity[], totalCount?: number): Generator<StreamChunk> {
    const total = totalCount ?? entities.length;
    let chunkIndex = 0;
    let cursor = 0;

    while (cursor < entities.length) {
      const chunk: SemanticEntity[] = [];
      let tokensInChunk = 0;

      while (
        cursor < entities.length &&
        chunk.length < this.config.maxEntitiesPerChunk &&
        tokensInChunk < this.config.maxTokensPerChunk
      ) {
        const entity = entities[cursor]!;
        const entityTokens = estimateEntityTokens(entity);

        if (chunk.length > 0 && tokensInChunk + entityTokens > this.config.maxTokensPerChunk) {
          break;
        }

        chunk.push(entity);
        tokensInChunk += entityTokens;
        cursor++;
      }

      if (chunk.length === 0) break;

      yield {
        metadata: {
          chunkIndex,
          moreChunks: cursor < entities.length,
          totalCount: total,
          tokensInChunk,
        },
        entities: chunk,
      };

      chunkIndex++;
    }
  }

  /**
   * Convert a list of entities into a ready-to-send SSE stream string.
   * Includes all chunks plus the [DONE] terminator.
   *
   * @param entities - Entities to encode
   */
  encodeStreamResponse(entities: SemanticEntity[]): string {
    const parts: string[] = [];
    for (const chunk of this.streamEntities(entities)) {
      parts.push(encodeSSEEvent(chunk));
    }
    parts.push(encodeSSEDone());
    return parts.join('');
  }
}
