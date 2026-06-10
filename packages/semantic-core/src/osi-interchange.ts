import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'osi-interchange' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type OsiNodeType = 'entity' | 'glossary_term' | 'metric';

export type OsiNode = {
  '@id': string;
  '@type': string;
  label: string;
  [key: string]: unknown;
};

export type OsiDocument = {
  '@context': Record<string, string>;
  '@graph': OsiNode[];
  exportedAt: string;
  workspaceId: string;
  totalNodes: number;
};

export type ImportSummary = {
  totalNodes: number;
  imported: { entities: number; glossaryTerms: number; metrics: number };
  skipped: number;
  errors: { nodeId: string; message: string }[];
};

// ─── Validation ───────────────────────────────────────────────────────────────

const OsiNodeSchema = z.object({
  '@id': z.string().min(1),
  '@type': z.string().min(1),
  label: z.string().min(1),
});

const OsiDocumentSchema = z.object({
  '@context': z.record(z.string()),
  '@graph': z.array(OsiNodeSchema),
  exportedAt: z.string(),
  workspaceId: z.string().min(1),
  totalNodes: z.number().int().min(0),
});

/**
 * Validate and parse a raw OSI document JSON string.
 */
export function parseOsiDocument(raw: string): Result<OsiDocument, Error> {
  try {
    const obj: unknown = JSON.parse(raw);
    const result = OsiDocumentSchema.safeParse(obj);
    if (!result.success) {
      return err(new Error(`Invalid OSI document: ${result.error.message}`));
    }
    return ok(result.data as OsiDocument);
  } catch (e) {
    return err(new Error(`Failed to parse OSI JSON: ${e instanceof Error ? e.message : String(e)}`));
  }
}

/**
 * Classify an OSI node by its @type URI.
 */
export function classifyNode(node: OsiNode): OsiNodeType {
  const t = node['@type'].toLowerCase();
  if (t.includes('metric')) return 'metric';
  if (t.includes('glossary') || t.includes('term')) return 'glossary_term';
  return 'entity';
}

/**
 * Extract entity type from an OSI @type URI.
 * e.g. "https://schema.iris.ai/v1/contact" → "contact"
 */
export function extractEntityType(osiType: string): string {
  const parts = osiType.split('/');
  return parts[parts.length - 1]?.toLowerCase() ?? 'unknown';
}

// ─── OsiInterchangeService ────────────────────────────────────────────────────

export class OsiInterchangeService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Import entities and glossary terms from an OSI document into the workspace.
   * Uses ON CONFLICT DO UPDATE for idempotent upsert.
   *
   * @param workspaceId - Target workspace
   * @param doc         - Parsed OSI document
   */
  async importFromOsi(workspaceId: string, doc: OsiDocument): Promise<ImportSummary> {
    const summary: ImportSummary = {
      totalNodes: doc['@graph'].length,
      imported: { entities: 0, glossaryTerms: 0, metrics: 0 },
      skipped: 0,
      errors: [],
    };

    for (const node of doc['@graph']) {
      const nodeType = classifyNode(node);

      try {
        if (nodeType === 'entity') {
          await this.importEntity(workspaceId, node);
          summary.imported.entities++;
        } else if (nodeType === 'glossary_term') {
          await this.importGlossaryTerm(workspaceId, node);
          summary.imported.glossaryTerms++;
        } else if (nodeType === 'metric') {
          await this.importMetric(workspaceId, node);
          summary.imported.metrics++;
        } else {
          summary.skipped++;
        }
      } catch (e) {
        summary.errors.push({ nodeId: node['@id'], message: e instanceof Error ? e.message : String(e) });
      }
    }

    log.info('OSI import complete', { workspaceId, summary });
    return summary;
  }

  private async importEntity(workspaceId: string, node: OsiNode): Promise<void> {
    const entityType = extractEntityType(node['@type']);
    const attributes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k !== '@id' && k !== '@type' && k !== 'label' && k !== 'sourceId') {
        attributes[k] = v;
      }
    }
    const sourceId = (node['sourceId'] as string | undefined) ?? node['@id'];

    await this.sql`
      INSERT INTO iris_entities
        (id, workspace_id, type, label, attributes, relationships, last_modified, source_id)
      VALUES (
        ${node['@id']},
        ${workspaceId},
        ${entityType},
        ${node.label},
        ${this.sql.json(attributes as Parameters<typeof this.sql.json>[0])},
        '[]'::jsonb,
        NOW(),
        ${sourceId}
      )
      ON CONFLICT (id) DO UPDATE SET
        label      = EXCLUDED.label,
        attributes = EXCLUDED.attributes,
        last_modified = NOW()
    `;
  }

  private async importGlossaryTerm(workspaceId: string, node: OsiNode): Promise<void> {
    const definition = (node['definition'] as string | undefined) ?? '';
    const termId = node['@id'].split('/').pop() ?? node['@id'];

    await this.sql`
      INSERT INTO iris_glossary_terms
        (workspace_id, term, definition, status)
      VALUES (
        ${workspaceId},
        ${node.label},
        ${definition},
        'approved'
      )
      ON CONFLICT (workspace_id, term) DO UPDATE SET
        definition = EXCLUDED.definition
    `;
    void termId;
  }

  private async importMetric(workspaceId: string, node: OsiNode): Promise<void> {
    const formula = (node['formula'] as string | undefined) ?? '';
    const description = (node['definition'] as string | undefined) ?? '';

    await this.sql`
      INSERT INTO iris_metrics
        (workspace_id, name, formula, description)
      VALUES (
        ${workspaceId},
        ${node.label},
        ${formula},
        ${description}
      )
      ON CONFLICT (workspace_id, name) DO UPDATE SET
        formula = EXCLUDED.formula,
        description = EXCLUDED.description
    `;
  }
}
