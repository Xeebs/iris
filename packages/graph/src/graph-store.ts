import neo4j, { type Driver, type Session } from 'neo4j-driver';
import { ok, err, type Result } from 'neverthrow';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'graph-store' });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RelatedEntity {
  id: string;
  type: string;
  label: string;
  relationshipType: string;
  workspaceId: string;
}

/**
 * Abstraction over the knowledge graph backend.
 * All methods are scoped to a workspaceId to enforce tenant isolation.
 */
export interface GraphStore {
  /**
   * Upsert an entity node in the graph.
   * If the node already exists (same id + workspaceId), it is updated in place.
   */
  addEntity(entity: SemanticEntity, workspaceId: string): Promise<Result<void, Error>>;

  /**
   * Create a directed relationship from sourceId to targetId within a workspace.
   * If the relationship already exists it is replaced (MERGE semantics).
   *
   * @param type - Logical relationship type (e.g. "belongs_to", "owns", "references")
   */
  addRelationship(
    sourceId: string,
    targetId: string,
    type: string,
    workspaceId: string,
  ): Promise<Result<void, Error>>;

  /**
   * Return entities related to entityId within a workspace.
   * Optionally filter by relationship type and cap results via limit.
   */
  getRelated(
    entityId: string,
    workspaceId: string,
    relationshipType?: string,
    limit?: number,
  ): Promise<Result<RelatedEntity[], Error>>;

  /**
   * Delete an entity node and all of its relationships from the graph.
   */
  removeEntity(entityId: string, workspaceId: string): Promise<Result<void, Error>>;

  /**
   * Delete all relationships between two entities within a workspace.
   * Does not remove the entity nodes themselves.
   */
  removeRelationship(
    sourceId: string,
    targetId: string,
    workspaceId: string,
  ): Promise<Result<void, Error>>;

  /**
   * Close the underlying driver connection. Call once during shutdown.
   */
  close(): Promise<void>;
}

// ─── Neo4j Implementation ───────────────────────────────────────────────────

/**
 * Neo4j-backed implementation of GraphStore.
 *
 * Node labels: `IrisEntity { id, workspaceId, type, label }`
 * Relationships: `[:IRIS_REL { type, workspaceId }]` — dynamic type stored as property
 * to avoid Neo4j schema explosion from many relationship types.
 *
 * All queries include `workspaceId` in node/relationship predicates for tenant isolation.
 */
export class Neo4jGraphStore implements GraphStore {
  private driver: Driver;

  constructor(
    uri: string,
    username: string,
    password: string,
  ) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }

  /** Create uniqueness constraints on first use. Call once at startup. */
  async initialize(): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `CREATE CONSTRAINT iris_entity_id IF NOT EXISTS
         FOR (e:IrisEntity) REQUIRE (e.id, e.workspaceId) IS UNIQUE`,
      );
      log.info('Neo4j constraints created');
    } catch (e) {
      log.warn('Could not create Neo4j constraints (may already exist)', { error: e });
    } finally {
      await session.close();
    }
  }

  async addEntity(entity: SemanticEntity, workspaceId: string): Promise<Result<void, Error>> {
    const session = this.driver.session();
    try {
      await session.run(
        `MERGE (e:IrisEntity { id: $id, workspaceId: $workspaceId })
         SET e.type = $type, e.label = $label`,
        { id: entity.id, workspaceId, type: entity.type, label: entity.label },
      );
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to add entity to graph', { entityId: entity.id, workspaceId, error });
      return err(error);
    } finally {
      await session.close();
    }
  }

  async addRelationship(
    sourceId: string,
    targetId: string,
    type: string,
    workspaceId: string,
  ): Promise<Result<void, Error>> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (src:IrisEntity { id: $sourceId, workspaceId: $workspaceId })
         MATCH (tgt:IrisEntity { id: $targetId, workspaceId: $workspaceId })
         MERGE (src)-[r:IRIS_REL { type: $type, workspaceId: $workspaceId }]->(tgt)`,
        { sourceId, targetId, type, workspaceId },
      );
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to add relationship to graph', { sourceId, targetId, type, error });
      return err(error);
    } finally {
      await session.close();
    }
  }

  async getRelated(
    entityId: string,
    workspaceId: string,
    relationshipType?: string,
    limit = 25,
  ): Promise<Result<RelatedEntity[], Error>> {
    const session = this.driver.session();
    try {
      const typeFilter = relationshipType ? ' AND r.type = $relType' : '';
      const result = await session.run(
        `MATCH (src:IrisEntity { id: $entityId, workspaceId: $workspaceId })
         MATCH (src)-[r:IRIS_REL { workspaceId: $workspaceId }]->(tgt:IrisEntity)
         WHERE tgt.workspaceId = $workspaceId${typeFilter}
         RETURN tgt.id AS id, tgt.type AS type, tgt.label AS label,
                r.type AS relType
         LIMIT $limit`,
        { entityId, workspaceId, relType: relationshipType ?? null, limit: neo4j.int(limit) },
      );

      const related: RelatedEntity[] = result.records.map((record) => ({
        id: record.get('id') as string,
        type: record.get('type') as string,
        label: record.get('label') as string,
        relationshipType: record.get('relType') as string,
        workspaceId,
      }));
      return ok(related);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to get related entities', { entityId, workspaceId, error });
      return err(error);
    } finally {
      await session.close();
    }
  }

  async removeEntity(entityId: string, workspaceId: string): Promise<Result<void, Error>> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (e:IrisEntity { id: $entityId, workspaceId: $workspaceId })
         DETACH DELETE e`,
        { entityId, workspaceId },
      );
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to remove entity from graph', { entityId, workspaceId, error });
      return err(error);
    } finally {
      await session.close();
    }
  }

  async removeRelationship(
    sourceId: string,
    targetId: string,
    workspaceId: string,
  ): Promise<Result<void, Error>> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (src:IrisEntity { id: $sourceId, workspaceId: $workspaceId })
               -[r:IRIS_REL { workspaceId: $workspaceId }]->
               (tgt:IrisEntity { id: $targetId, workspaceId: $workspaceId })
         DELETE r`,
        { sourceId, targetId, workspaceId },
      );
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to remove relationship', { sourceId, targetId, error });
      return err(error);
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  /** Exposed for unit testing — returns a session from the underlying driver. */
  _getSession(): Session {
    return this.driver.session();
  }
}
