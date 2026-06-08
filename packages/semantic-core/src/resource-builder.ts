import type { SemanticEntity } from '@iris/connector-sdk';
import type { VectorStore } from './vector-store.js';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'resource-builder' });

export interface EntityResource {
  uri: string;
  mimeType: 'application/json';
  text: string;
}

export interface GraphResource {
  uri: string;
  mimeType: 'application/json';
  text: string;
}

export interface EntityGraph {
  root: SemanticEntity;
  related: SemanticEntity[];
  depth: number;
}

/**
 * Build a structured JSON resource for a single entity by ID.
 * Returns null when the entity does not exist.
 *
 * @param entityId    - Globally unique entity ID
 * @param workspaceId - Workspace the entity belongs to
 * @param vectorStore - Initialized vector store
 */
export async function buildEntityResource(
  entityId: string,
  workspaceId: string,
  vectorStore: VectorStore,
): Promise<EntityResource | null> {
  const entity = await vectorStore.getById(workspaceId, entityId);
  if (!entity) {
    log.debug('Entity not found for resource build', { entityId, workspaceId });
    return null;
  }

  return {
    uri: `entity://${workspaceId}/${entityId}`,
    mimeType: 'application/json',
    text: JSON.stringify(entity, null, 2),
  };
}

/**
 * Build a relationship subgraph resource for an entity at a given depth.
 * Fetches related entities by traversing relationship targetIds up to `depth` hops.
 * This is a best-effort graph: missing related entities are silently skipped.
 *
 * @param entityId    - Root entity ID
 * @param workspaceId - Workspace the entity belongs to
 * @param vectorStore - Initialized vector store
 * @param depth       - Number of relationship hops to traverse (max 2)
 */
export async function buildGraphResource(
  entityId: string,
  workspaceId: string,
  vectorStore: VectorStore,
  depth = 1,
): Promise<GraphResource | null> {
  const clampedDepth = Math.min(depth, 2);
  const root = await vectorStore.getById(workspaceId, entityId);
  if (!root) return null;

  const visited = new Set<string>([entityId]);
  const related: SemanticEntity[] = [];

  let frontier: SemanticEntity[] = [root];
  for (let d = 0; d < clampedDepth; d++) {
    const nextFrontier: SemanticEntity[] = [];
    for (const entity of frontier) {
      for (const rel of entity.relationships) {
        if (visited.has(rel.targetId)) continue;
        visited.add(rel.targetId);
        const relatedEntity = await vectorStore.getById(workspaceId, rel.targetId);
        if (relatedEntity) {
          related.push(relatedEntity);
          nextFrontier.push(relatedEntity);
        }
      }
    }
    frontier = nextFrontier;
  }

  const graph: EntityGraph = { root, related, depth: clampedDepth };

  return {
    uri: `graph://${workspaceId}/${entityId}?depth=${clampedDepth}`,
    mimeType: 'application/json',
    text: JSON.stringify(graph, null, 2),
  };
}

/**
 * Build a text resource listing all available entity resources in a workspace.
 * Used for resource discovery / IDE autocomplete.
 *
 * @param workspaceId   - Workspace to enumerate
 * @param entityTypes   - Filter by entity types (optional)
 * @param vectorStore   - Initialized vector store
 * @param limit         - Maximum entities to enumerate (default: 100)
 */
export async function listEntityResourceURIs(
  workspaceId: string,
  vectorStore: VectorStore,
  entityTypes?: string[],
  limit = 100,
): Promise<string[]> {
  const results = await vectorStore.search(
    Array(1536).fill(0) as number[], // zero vector = recall all (low quality but valid for listing)
    limit,
    { workspaceId, ...(entityTypes ? { entityTypes } : {}) },
  );

  return results.map((r) => `entity://${workspaceId}/${r.entity.id}`);
}
