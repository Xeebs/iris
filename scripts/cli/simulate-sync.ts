import postgres from 'postgres';
import { resolve } from 'node:path';

const IRIS_ROOT = resolve(import.meta.dirname, '../..');

type ConnectorRow = {
  connector_instance_id: string;
  connector_type: string;
  workspace_id: string;
  last_synced_at: string | null;
  is_active: boolean;
};

type EntitySample = {
  entity_type: string;
  label: string;
  attributes: Record<string, unknown>;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildEmbeddingInput(entity: EntitySample): string {
  const attrs = Object.entries(entity.attributes)
    .filter(([, v]) => v !== null && v !== undefined)
    .slice(0, 10)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(', ') : v}`)
    .join('; ');
  return `${entity.entity_type}: ${entity.label}. ${attrs}`;
}

/**
 * Dry-run a sync for a connector: validate schema mapping and show token estimates.
 * Does not persist any entities to the database.
 *
 * @param connectorId - ID of the connector instance to simulate
 */
export async function runSyncSimulate(connectorId: string): Promise<void> {
  const pgUrl = process.env['DATABASE_URL'];
  if (!pgUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  console.log(`\n▶ Sync Simulate (dry run)`);
  console.log(`  Connector: ${connectorId}\n`);

  const sql = postgres(pgUrl);

  try {
    // Fetch connector metadata
    const connectors = await sql`
      SELECT connector_instance_id, connector_type, workspace_id, last_synced_at, is_active
      FROM connector_instances
      WHERE connector_instance_id = ${connectorId}
    ` as ConnectorRow[];

    if (connectors.length === 0) {
      console.error(`  Connector not found: ${connectorId}`);
      console.error('  List available connectors with: SELECT connector_instance_id, connector_type FROM connector_instances;');
      return;
    }

    const connector = connectors[0]!;
    console.log(`  Type:        ${connector.connector_type}`);
    console.log(`  Workspace:   ${connector.workspace_id}`);
    console.log(`  Last synced: ${connector.last_synced_at ?? 'never'}`);
    console.log(`  Active:      ${connector.is_active}`);
    console.log();

    // Sample existing entities for this connector to estimate token usage
    const sample = await sql`
      SELECT entity_type, label, attributes
      FROM semantic_entities
      WHERE workspace_id = ${connector.workspace_id}
        AND source_id LIKE ${connector.connector_type + ':%'}
      LIMIT 50
    ` as EntitySample[];

    if (sample.length === 0) {
      console.log('  No existing entities found for this connector.');
      console.log('  Cannot estimate token usage without data — run a real sync first.\n');
      return;
    }

    // Schema validation: check required fields
    const missingLabel = sample.filter(e => !e.label || e.label.trim() === '').length;
    const missingType = sample.filter(e => !e.entity_type).length;

    console.log(`  Schema Validation (${sample.length} sample entities):`);
    console.log(`    Missing label:        ${missingLabel}`);
    console.log(`    Missing entity_type:  ${missingType}`);
    if (missingLabel === 0 && missingType === 0) {
      console.log('    ✓ All required fields present');
    } else {
      console.log('    ✗ Schema issues detected — fix before live sync');
    }

    // Token estimation
    const embeddingInputs = sample.map(buildEmbeddingInput);
    const tokenCounts = embeddingInputs.map(estimateTokens);
    const totalTokens = tokenCounts.reduce((s, t) => s + t, 0);
    const avgTokens = totalTokens / tokenCounts.length;
    const maxTokens = Math.max(...tokenCounts);
    const over512 = tokenCounts.filter(t => t > 512).length;

    console.log(`\n  Token Estimates (embedding inputs):`);
    console.log(`    Sample size:   ${sample.length} entities`);
    console.log(`    Avg per entity: ${avgTokens.toFixed(0)} tokens`);
    console.log(`    Max per entity: ${maxTokens} tokens`);
    console.log(`    Over 512t:     ${over512} entities (will be truncated)`);

    // Distribution by entity type
    const byType = new Map<string, number>();
    for (const e of sample) {
      byType.set(e.entity_type, (byType.get(e.entity_type) ?? 0) + 1);
    }

    console.log('\n  Entity Type Distribution:');
    for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      const bar = '█'.repeat(Math.round(count / sample.length * 20));
      console.log(`    ${type.padEnd(20)} ${String(count).padStart(4)}  ${bar}`);
    }

    // Cost estimate
    const costPer1M = 0.02; // text-embedding-3-small pricing
    const estimatedCost = (totalTokens / 1_000_000) * costPer1M;
    console.log(`\n  Estimated embedding cost (full sync projection):`);
    console.log(`    Sample tokens:    ${totalTokens}`);
    console.log(`    Estimated cost:   $${estimatedCost.toFixed(6)} (for ${sample.length} entities)`);
    console.log(`\n  ✓ Dry run complete — no data was persisted`);

    if (over512 > 0) {
      console.log(`\n  ⚠ WARNING: ${over512} entity(s) exceed 512 token embedding input — review attribute richness`);
    }
    if (avgTokens > 400) {
      console.log(`  ⚠ WARNING: Average embedding input is ${avgTokens.toFixed(0)} tokens — consider trimming attribute set`);
    }
  } finally {
    await sql.end();
  }
}
