import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import type { JSONValue } from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'data-exporter' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportOptions {
  entityTypes?: string[] | undefined;
  connectorInstanceId?: string | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
  includeGlossary?: boolean | undefined;
  includeMetrics?: boolean | undefined;
  includeRelationships?: boolean | undefined;
  includeConfigs?: boolean | undefined;
}

export interface ExportedEntity {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
  relationships: Array<{ type: string; targetId: string }>;
  sourceId: string;
  connectorId: string;
  lastModified: string;
}

export interface WorkspaceExport {
  version: '1.0';
  exportedAt: string;
  workspaceId: string;
  exportType: 'full' | 'entities' | 'schema';
  entities: ExportedEntity[];
  glossaryTerms: GlossaryExport[];
  metrics: MetricExport[];
  relationships: RelationshipExport[];
  schemaDefinitions: SchemaExport[];
  entityCount: number;
}

export interface GlossaryExport {
  term: string;
  definition: string;
  exampleValue: string | null;
  status: string;
}

export interface MetricExport {
  name: string;
  formula: string;
  description: string;
}

export interface RelationshipExport {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  confidenceScore: number;
}

export interface SchemaExport {
  connectorId: string;
  entityType: string;
  fields: string[];
}

export interface ExportJob {
  id: string;
  workspaceId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  exportType: 'full' | 'entities' | 'schema';
  options: ExportOptions | null;
  progressPct: number;
  entityCount: number | null;
  resultData: WorkspaceExport | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

// ─── DataExporter ─────────────────────────────────────────────────────────────

/**
 * @param sql - Postgres client
 */
export class DataExporter {
  constructor(private readonly sql: SqlClient) {}

  /**
   * @param workspaceId - Workspace to export
   * @param exportType - Type of export job to create
   * @param options - Filtering and inclusion options
   * @returns Created export job ID
   */
  async createExportJob(
    workspaceId: string,
    exportType: 'full' | 'entities' | 'schema',
    options?: ExportOptions,
  ): Promise<Result<string, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO export_jobs (workspace_id, status, export_type, options)
        VALUES (${workspaceId}, 'pending', ${exportType}, ${this.sql.json((options ?? {}) as unknown as JSONValue)})
        RETURNING id
      `;
      const jobId = (rows[0] as { id: string }).id;
      log.info('Export job created', { workspaceId, exportType, jobId });

      // Run synchronously in background (no awaiting)
      void this.runExportJob(jobId, workspaceId, exportType, options);

      return ok(jobId);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to create export job', { workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * @param jobId - Export job to retrieve
   * @param workspaceId - Workspace for isolation check
   * @returns Export job record
   */
  async getExportJob(jobId: string, workspaceId: string): Promise<Result<ExportJob, Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM export_jobs
        WHERE id = ${jobId} AND workspace_id = ${workspaceId}
      `;
      if (rows.length === 0) {
        return err(new Error('Export job not found'));
      }
      return ok(this.mapJobRow(rows[0] as ExportJobRow));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return err(error);
    }
  }

  /**
   * @param workspaceId - Workspace to list jobs for
   * @param limit - Max results
   * @param cursor - Pagination cursor (job ID)
   * @returns List of export jobs
   */
  async listExportJobs(
    workspaceId: string,
    limit = 50,
    cursor?: string,
  ): Promise<Result<{ jobs: ExportJob[]; hasMore: boolean }, Error>> {
    try {
      const rows = cursor
        ? await this.sql`
            SELECT * FROM export_jobs
            WHERE workspace_id = ${workspaceId}
              AND created_at < (SELECT created_at FROM export_jobs WHERE id = ${cursor})
            ORDER BY created_at DESC
            LIMIT ${limit + 1}
          `
        : await this.sql`
            SELECT * FROM export_jobs
            WHERE workspace_id = ${workspaceId}
            ORDER BY created_at DESC
            LIMIT ${limit + 1}
          `;

      const hasMore = rows.length > limit;
      const jobs = rows.slice(0, limit).map((r) => this.mapJobRow(r as ExportJobRow));
      return ok({ jobs, hasMore });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return err(error);
    }
  }

  /**
   * @param workspaceId - Workspace to export
   * @param options - Export options
   * @returns Full workspace export payload
   */
  async exportWorkspace(
    workspaceId: string,
    options: ExportOptions = {},
  ): Promise<Result<WorkspaceExport, Error>> {
    const start = Date.now();
    log.info('Starting workspace export', { workspaceId, options });

    try {
      const [entities, glossaryTerms, metrics, relationships, schemaDefinitions] =
        await Promise.all([
          this.fetchEntities(workspaceId, options),
          options.includeGlossary !== false ? this.fetchGlossary(workspaceId) : Promise.resolve([]),
          options.includeMetrics !== false ? this.fetchMetrics(workspaceId) : Promise.resolve([]),
          options.includeRelationships !== false
            ? this.fetchRelationships(workspaceId, options)
            : Promise.resolve([]),
          this.fetchSchemaDefinitions(workspaceId),
        ]);

      const payload: WorkspaceExport = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        workspaceId,
        exportType: 'full',
        entities,
        glossaryTerms,
        metrics,
        relationships,
        schemaDefinitions,
        entityCount: entities.length,
      };

      log.info('Workspace export complete', {
        workspaceId,
        entityCount: entities.length,
        durationMs: Date.now() - start,
      });

      return ok(payload);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Workspace export failed', { workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * @param workspaceId - Workspace to export entities from
   * @param filters - Filtering options
   * @returns Filtered entity list
   */
  async exportEntities(
    workspaceId: string,
    filters: Pick<ExportOptions, 'entityTypes' | 'connectorInstanceId' | 'since' | 'until'> = {},
  ): Promise<Result<ExportedEntity[], Error>> {
    try {
      const entities = await this.fetchEntities(workspaceId, filters);
      return ok(entities);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return err(error);
    }
  }

  /**
   * @param workspaceId - Workspace to export schema for
   * @returns Schema definitions per connector
   */
  async exportSchema(workspaceId: string): Promise<Result<SchemaExport[], Error>> {
    try {
      const schemas = await this.fetchSchemaDefinitions(workspaceId);
      return ok(schemas);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return err(error);
    }
  }

  /**
   * @param backup - Previously exported workspace backup
   * @param targetWorkspaceId - Workspace to import into
   * @returns Count of imported entities
   */
  async importWorkspace(
    backup: WorkspaceExport,
    targetWorkspaceId: string,
  ): Promise<Result<{ importedEntities: number; importedTerms: number; importedMetrics: number }, Error>> {
    log.info('Starting workspace import', {
      targetWorkspaceId,
      sourceWorkspaceId: backup.workspaceId,
      entityCount: backup.entityCount,
    });

    try {
      let importedEntities = 0;
      let importedTerms = 0;
      let importedMetrics = 0;

      for (const entity of backup.entities) {
        await this.sql`
          INSERT INTO semantic_entities (
            id, workspace_id, type, label, attributes, source_id, connector_id, last_modified
          ) VALUES (
            ${entity.id}, ${targetWorkspaceId}, ${entity.type}, ${entity.label},
            ${this.sql.json(entity.attributes as unknown as JSONValue)}, ${entity.sourceId}, ${entity.connectorId},
            ${entity.lastModified}
          )
          ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label,
            attributes = EXCLUDED.attributes,
            last_modified = EXCLUDED.last_modified
        `;
        importedEntities++;
      }

      for (const term of backup.glossaryTerms) {
        await this.sql`
          INSERT INTO glossary_terms (workspace_id, term, definition, example_value, status)
          VALUES (${targetWorkspaceId}, ${term.term}, ${term.definition}, ${term.exampleValue}, ${term.status})
          ON CONFLICT (workspace_id, term) DO UPDATE SET
            definition = EXCLUDED.definition,
            example_value = EXCLUDED.example_value
        `;
        importedTerms++;
      }

      for (const metric of backup.metrics) {
        await this.sql`
          INSERT INTO metrics (workspace_id, name, formula, description)
          VALUES (${targetWorkspaceId}, ${metric.name}, ${metric.formula}, ${metric.description})
          ON CONFLICT (workspace_id, name) DO UPDATE SET
            formula = EXCLUDED.formula,
            description = EXCLUDED.description
        `;
        importedMetrics++;
      }

      log.info('Workspace import complete', {
        targetWorkspaceId,
        importedEntities,
        importedTerms,
        importedMetrics,
      });

      return ok({ importedEntities, importedTerms, importedMetrics });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Workspace import failed', { targetWorkspaceId, error: error.message });
      return err(error);
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async runExportJob(
    jobId: string,
    workspaceId: string,
    exportType: 'full' | 'entities' | 'schema',
    options?: ExportOptions,
  ): Promise<void> {
    try {
      await this.sql`
        UPDATE export_jobs SET status = 'running', started_at = now(), progress_pct = 10
        WHERE id = ${jobId}
      `;

      const result = await this.exportWorkspace(workspaceId, options ?? {});

      if (result.isErr()) {
        await this.sql`
          UPDATE export_jobs
          SET status = 'failed', error_message = ${result.error.message}, completed_at = now()
          WHERE id = ${jobId}
        `;
        return;
      }

      const payload = { ...result.value, exportType };

      await this.sql`
        UPDATE export_jobs
        SET status = 'completed',
            progress_pct = 100,
            entity_count = ${payload.entityCount},
            result_data = ${this.sql.json(payload as unknown as JSONValue)},
            completed_at = now()
        WHERE id = ${jobId}
      `;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      await this.sql`
        UPDATE export_jobs
        SET status = 'failed', error_message = ${error.message}, completed_at = now()
        WHERE id = ${jobId}
      `.catch(() => undefined);
    }
  }

  private async fetchEntities(workspaceId: string, options: ExportOptions): Promise<ExportedEntity[]> {
    // Use NULL-safe conditions to avoid nested sql template calls (which complicate testing)
    const entityTypes = options.entityTypes?.length ? options.entityTypes : null;
    const connectorId = options.connectorInstanceId ?? null;
    const since = options.since?.toISOString() ?? null;
    const until = options.until?.toISOString() ?? null;

    const rows = await this.sql`
      SELECT id, type, label, attributes, source_id, connector_id,
             last_modified, relationships
      FROM semantic_entities
      WHERE workspace_id = ${workspaceId}
        AND (${entityTypes}::text[] IS NULL OR type = ANY(${entityTypes}::text[]))
        AND (${connectorId}::uuid IS NULL OR connector_id = ${connectorId}::uuid)
        AND (${since}::timestamptz IS NULL OR last_modified >= ${since}::timestamptz)
        AND (${until}::timestamptz IS NULL OR last_modified <= ${until}::timestamptz)
      ORDER BY last_modified DESC
    `;

    return rows.map((r) => {
      const row = r as EntityRow;
      return {
        id: row.id,
        type: row.type,
        label: row.label,
        attributes: (row.attributes as Record<string, unknown>) ?? {},
        relationships: (row.relationships as Array<{ type: string; targetId: string }>) ?? [],
        sourceId: row.source_id,
        connectorId: row.connector_id,
        lastModified: row.last_modified,
      };
    });
  }

  private async fetchGlossary(workspaceId: string): Promise<GlossaryExport[]> {
    const rows = await this.sql`
      SELECT term, definition, example_value, status
      FROM glossary_terms
      WHERE workspace_id = ${workspaceId}
      ORDER BY term ASC
    `;
    return rows.map((r) => {
      const row = r as GlossaryRow;
      return {
        term: row.term,
        definition: row.definition,
        exampleValue: row.example_value,
        status: row.status,
      };
    });
  }

  private async fetchMetrics(workspaceId: string): Promise<MetricExport[]> {
    const rows = await this.sql`
      SELECT name, formula, description
      FROM metrics
      WHERE workspace_id = ${workspaceId}
      ORDER BY name ASC
    `;
    return rows.map((r) => {
      const row = r as MetricRow;
      return { name: row.name, formula: row.formula, description: row.description };
    });
  }

  private async fetchRelationships(
    workspaceId: string,
    _options: ExportOptions,
  ): Promise<RelationshipExport[]> {
    const rows = await this.sql`
      SELECT er.entity_id, er.related_entity_id, er.relationship_type, er.confidence_score
      FROM entity_relationships er
      JOIN semantic_entities se ON se.id = er.entity_id
      WHERE se.workspace_id = ${workspaceId}
      ORDER BY er.entity_id ASC
    `;
    return rows.map((r) => {
      const row = r as RelationshipRow;
      return {
        sourceId: row.entity_id,
        targetId: row.related_entity_id,
        relationshipType: row.relationship_type,
        confidenceScore: row.confidence_score,
      };
    });
  }

  private async fetchSchemaDefinitions(workspaceId: string): Promise<SchemaExport[]> {
    const rows = await this.sql`
      SELECT connector_id, entity_type, fields
      FROM connector_schemas
      WHERE workspace_id = ${workspaceId}
      ORDER BY connector_id ASC, entity_type ASC
    `;
    return rows.map((r) => {
      const row = r as SchemaRow;
      return {
        connectorId: row.connector_id,
        entityType: row.entity_type,
        fields: (row.fields as string[]) ?? [],
      };
    });
  }

  private mapJobRow(row: ExportJobRow): ExportJob {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      status: row.status,
      exportType: row.export_type,
      options: row.options as ExportOptions | null,
      progressPct: row.progress_pct,
      entityCount: row.entity_count,
      resultData: row.result_data as WorkspaceExport | null,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }
}

// ─── Row types ─────────────────────────────────────────────────────────────────

interface ExportJobRow {
  id: string;
  workspace_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  export_type: 'full' | 'entities' | 'schema';
  options: unknown;
  progress_pct: number;
  entity_count: number | null;
  result_data: unknown;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

interface EntityRow {
  id: string;
  type: string;
  label: string;
  attributes: unknown;
  source_id: string;
  connector_id: string;
  last_modified: string;
  relationships: unknown;
}

interface GlossaryRow {
  term: string;
  definition: string;
  example_value: string | null;
  status: string;
}

interface MetricRow {
  name: string;
  formula: string;
  description: string;
}

interface RelationshipRow {
  entity_id: string;
  related_entity_id: string;
  relationship_type: string;
  confidence_score: number;
}

interface SchemaRow {
  connector_id: string;
  entity_type: string;
  fields: unknown;
}
