import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'osi-exporter' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OsiExportOptions {
  entityTypes?: string[] | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
  includeGlossary?: boolean | undefined;
  includeMetrics?: boolean | undefined;
}

export interface OsiNode {
  '@id': string;
  '@type': string;
  label: string;
  [key: string]: unknown;
}

export interface OsiDocument {
  '@context': Record<string, string>;
  '@graph': OsiNode[];
  exportedAt: string;
  workspaceId: string;
  totalNodes: number;
}

// ─── Context definition ───────────────────────────────────────────────────────

const OSI_CONTEXT: Record<string, string> = {
  '@vocab': 'https://schema.iris.ai/v1/',
  iris: 'https://schema.iris.ai/v1/',
  label: 'https://schema.org/name',
  definition: 'https://schema.org/description',
  formula: 'https://schema.iris.ai/v1/formula',
  exampleValue: 'https://schema.iris.ai/v1/exampleValue',
  sourceId: 'https://schema.iris.ai/v1/sourceId',
  lastModified: 'https://schema.org/dateModified',
};

// ─── Transformation helpers ───────────────────────────────────────────────────

interface EntityRow {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
  relationships: Array<{ type: string; targetId: string }>;
  last_modified: Date;
  source_id: string;
}

/**
 * Transform a raw iris_entity row into an OSI JSON-LD node.
 */
export function entityToOsiNode(row: EntityRow): OsiNode {
  const node: OsiNode = {
    '@id': row.id,
    '@type': `iris:${row.type}`,
    label: row.label,
    sourceId: row.source_id,
    lastModified: row.last_modified.toISOString(),
  };

  for (const [k, v] of Object.entries(row.attributes)) {
    if (v !== null && v !== undefined) node[k] = v;
  }

  if (row.relationships.length > 0) {
    node['iris:relatedTo'] = row.relationships.map(r => ({
      '@type': `iris:${r.type}`,
      '@id': r.targetId,
    }));
  }

  return node;
}

interface GlossaryRow {
  id: string;
  term: string;
  definition: string;
  example_value: string | null;
}

/**
 * Transform a glossary_terms row into an OSI JSON-LD node.
 */
export function glossaryTermToOsiNode(row: GlossaryRow): OsiNode {
  const node: OsiNode = {
    '@id': `iris:glossary:${row.id}`,
    '@type': 'iris:GlossaryTerm',
    label: row.term,
    definition: row.definition,
  };
  if (row.example_value !== null) node['exampleValue'] = row.example_value;
  return node;
}

interface MetricRow {
  id: string;
  name: string;
  formula: string;
  description: string;
}

/**
 * Transform a metrics row into an OSI JSON-LD node.
 */
export function metricToOsiNode(row: MetricRow): OsiNode {
  return {
    '@id': `iris:metric:${row.id}`,
    '@type': 'iris:Metric',
    label: row.name,
    formula: row.formula,
    definition: row.description,
  };
}

// ─── Export service ───────────────────────────────────────────────────────────

type SqlClient = ReturnType<typeof postgres>;

/**
 * Export all indexed data for a workspace as an OSI (JSON-LD) document.
 *
 * @param workspaceId - Workspace to export
 * @param options     - Optional filters: entityTypes, since, until, includeGlossary, includeMetrics
 * @param sql         - Postgres client
 */
export async function exportToOSI(
  workspaceId: string,
  options: OsiExportOptions,
  sql: SqlClient,
): Promise<Result<OsiDocument, Error>> {
  const {
    entityTypes,
    since,
    until,
    includeGlossary = true,
    includeMetrics = true,
  } = options;

  try {
    const nodes: OsiNode[] = [];

    // Entities
    const entityRows = await sql<EntityRow[]>`
      SELECT id, type, label, attributes, relationships, last_modified, source_id
      FROM iris_entities
      WHERE workspace_id = ${workspaceId}
        ${entityTypes && entityTypes.length > 0 ? sql`AND type = ANY(${entityTypes})` : sql``}
        ${since ? sql`AND last_modified >= ${since}` : sql``}
        ${until ? sql`AND last_modified <= ${until}` : sql``}
      ORDER BY type ASC, last_modified DESC
    `;
    for (const row of entityRows) {
      nodes.push(entityToOsiNode(row));
    }

    // Glossary terms
    if (includeGlossary) {
      const glossaryRows = await sql<GlossaryRow[]>`
        SELECT id, term, definition, example_value
        FROM glossary_terms
        WHERE workspace_id = ${workspaceId}
        ORDER BY term ASC
      `;
      for (const row of glossaryRows) {
        nodes.push(glossaryTermToOsiNode(row));
      }
    }

    // Metrics
    if (includeMetrics) {
      const metricRows = await sql<MetricRow[]>`
        SELECT id, name, formula, description
        FROM metrics
        WHERE workspace_id = ${workspaceId}
        ORDER BY name ASC
      `;
      for (const row of metricRows) {
        nodes.push(metricToOsiNode(row));
      }
    }

    const doc: OsiDocument = {
      '@context': OSI_CONTEXT,
      '@graph': nodes,
      exportedAt: new Date().toISOString(),
      workspaceId,
      totalNodes: nodes.length,
    };

    log.info('OSI export complete', {
      workspaceId,
      totalNodes: nodes.length,
      entityCount: entityRows.length,
    });

    return ok(doc);
  } catch (e) {
    log.error('OSI export failed', { workspaceId, error: e });
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
