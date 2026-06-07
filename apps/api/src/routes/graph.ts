import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'graph' });

type SqlClient = ReturnType<typeof postgres>;

const querySchema = z.object({
  workspaceId: z.string().min(1),
  entityTypes: z.string().optional(),
  relationshipTypes: z.string().optional(),
  search: z.string().optional(),
  depth: z.coerce.number().int().min(1).max(5).default(2),
  entityId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  sourceId: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  confidenceScore: number;
}

export interface GraphQueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type EntityRow = { id: string; type: string; label: string; source_id: string };
type RelRow = { id: string; entity_id: string; related_entity_id: string; relationship_type: string; confidence_score: number };

/**
 * @param sql - Postgres client
 */
export function createGraphRoutes(sql: SqlClient): Hono {
  const routes = new Hono();

  /** GET /api/v1/graph/query — return nodes and edges for a workspace subgraph */
  routes.get('/query', async (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.errors } },
        400,
      );
    }

    const { workspaceId, entityTypes, relationshipTypes, search, depth, entityId, limit } = parsed.data;
    const typeFilter = entityTypes ? entityTypes.split(',').map(t => t.trim()).filter(Boolean) : null;
    const relTypeFilter = relationshipTypes ? relationshipTypes.split(',').map(t => t.trim()).filter(Boolean) : null;

    try {
      let nodeRows: EntityRow[];

      if (entityId) {
        nodeRows = await expandFromEntity(sql, workspaceId, entityId, depth, typeFilter, relTypeFilter, limit);
      } else {
        nodeRows = await queryEntities(sql, workspaceId, typeFilter, search ?? null, limit);
      }

      const nodeIds = nodeRows.map(n => n.id);

      const edgeRows = nodeIds.length > 0
        ? await queryEdges(sql, workspaceId, nodeIds, relTypeFilter)
        : [];

      const result: GraphQueryResult = {
        nodes: nodeRows.map(r => ({ id: r.id, type: r.type, label: r.label, sourceId: r.source_id })),
        edges: edgeRows.map(r => ({
          id: r.id,
          source: r.entity_id,
          target: r.related_entity_id,
          type: r.relationship_type,
          confidenceScore: r.confidence_score,
        })),
      };

      log.info('Graph query complete', {
        workspaceId,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        entityId,
      });

      return c.json({ data: result });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Graph query failed', { workspaceId, error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Graph query failed' } }, 500);
    }
  });

  return routes;
}

async function queryEntities(
  sql: SqlClient,
  workspaceId: string,
  typeFilter: string[] | null,
  search: string | null,
  limit: number,
): Promise<EntityRow[]> {
  if (typeFilter && search) {
    return sql<EntityRow[]>`
      SELECT id, type, label, source_id
      FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        AND type = ANY(${typeFilter}::text[])
        AND label ILIKE ${'%' + search + '%'}
      ORDER BY indexed_at DESC
      LIMIT ${limit}
    `;
  }
  if (typeFilter) {
    return sql<EntityRow[]>`
      SELECT id, type, label, source_id
      FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        AND type = ANY(${typeFilter}::text[])
      ORDER BY indexed_at DESC
      LIMIT ${limit}
    `;
  }
  if (search) {
    return sql<EntityRow[]>`
      SELECT id, type, label, source_id
      FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        AND label ILIKE ${'%' + search + '%'}
      ORDER BY indexed_at DESC
      LIMIT ${limit}
    `;
  }
  return sql<EntityRow[]>`
    SELECT id, type, label, source_id
    FROM iris_entities
    WHERE workspace_id = ${workspaceId}
    ORDER BY indexed_at DESC
    LIMIT ${limit}
  `;
}

async function expandFromEntity(
  sql: SqlClient,
  workspaceId: string,
  rootId: string,
  depth: number,
  typeFilter: string[] | null,
  relTypeFilter: string[] | null,
  limit: number,
): Promise<EntityRow[]> {
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];

  for (let d = 0; d < depth && frontier.length > 0 && visited.size < limit; d++) {
    const remaining = limit - visited.size;
    const neighbors = relTypeFilter
      ? await sql<{ related_entity_id: string }[]>`
          SELECT DISTINCT related_entity_id
          FROM entity_relationships
          WHERE workspace_id = ${workspaceId}
            AND entity_id = ANY(${frontier}::text[])
            AND related_entity_id != ALL(${[...visited]}::text[])
            AND relationship_type = ANY(${relTypeFilter}::text[])
          LIMIT ${remaining}
        `
      : await sql<{ related_entity_id: string }[]>`
          SELECT DISTINCT related_entity_id
          FROM entity_relationships
          WHERE workspace_id = ${workspaceId}
            AND entity_id = ANY(${frontier}::text[])
            AND related_entity_id != ALL(${[...visited]}::text[])
          LIMIT ${remaining}
        `;

    frontier = neighbors.map(r => r.related_entity_id).filter(id => !visited.has(id));
    for (const id of frontier) visited.add(id);
  }

  const allIds = [...visited];
  return typeFilter
    ? sql<EntityRow[]>`
        SELECT id, type, label, source_id
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
          AND id = ANY(${allIds}::text[])
          AND type = ANY(${typeFilter}::text[])
        LIMIT ${limit}
      `
    : sql<EntityRow[]>`
        SELECT id, type, label, source_id
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
          AND id = ANY(${allIds}::text[])
        LIMIT ${limit}
      `;
}

async function queryEdges(
  sql: SqlClient,
  workspaceId: string,
  nodeIds: string[],
  relTypeFilter: string[] | null,
): Promise<RelRow[]> {
  return relTypeFilter
    ? sql<RelRow[]>`
        SELECT id::text, entity_id, related_entity_id, relationship_type, confidence_score
        FROM entity_relationships
        WHERE workspace_id = ${workspaceId}
          AND entity_id = ANY(${nodeIds}::text[])
          AND related_entity_id = ANY(${nodeIds}::text[])
          AND relationship_type = ANY(${relTypeFilter}::text[])
      `
    : sql<RelRow[]>`
        SELECT id::text, entity_id, related_entity_id, relationship_type, confidence_score
        FROM entity_relationships
        WHERE workspace_id = ${workspaceId}
          AND entity_id = ANY(${nodeIds}::text[])
          AND related_entity_id = ANY(${nodeIds}::text[])
      `;
}
