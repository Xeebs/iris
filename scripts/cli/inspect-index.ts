import postgres from 'postgres';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

const IRIS_ROOT = resolve(import.meta.dirname, '../..');

type EmbeddingFn = (text: string) => Promise<number[]>;

async function getEmbeddingFn(): Promise<EmbeddingFn> {
  const openAiKey = process.env['OPENAI_API_KEY'];
  if (!openAiKey) {
    throw new Error('OPENAI_API_KEY is required for index:inspect');
  }

  // Lazy-load openai to avoid import issues in script context
  const { default: OpenAI } = (await import('openai')) as { default: new (opts: { apiKey: string }) => { embeddings: { create: (opts: { model: string; input: string }) => Promise<{ data: { embedding: number[] }[] }> } } };
  const client = new OpenAI({ apiKey: openAiKey });

  return async (text: string) => {
    const response = await client.embeddings.create({ model: 'text-embedding-3-small', input: text });
    return response.data[0]!.embedding;
  };
}

type EntityRow = {
  entity_id: string;
  entity_type: string;
  label: string;
  workspace_id: string;
  similarity: number;
};

/**
 * Query the local vector index and display similarity scores for inspection.
 *
 * @param query - Natural language query to embed and search
 * @param topK - Number of results to return
 */
export async function runIndexInspect(query: string, topK = 10): Promise<void> {
  const pgUrl = process.env['DATABASE_URL'];
  if (!pgUrl) {
    console.error('DATABASE_URL is required. Copy .env.local and set DATABASE_URL.');
    process.exit(1);
  }

  console.log(`\n▶ Index Inspect`);
  console.log(`  Query: "${query}"`);
  console.log(`  Top K: ${topK}\n`);

  const sql = postgres(pgUrl);

  try {
    console.log('  Embedding query...');
    const embed = await getEmbeddingFn();
    const embedding = await embed(query);

    console.log(`  Vector dimensions: ${embedding.length}`);
    console.log('  Searching index...\n');

    const rows = await sql`
      SELECT
        entity_id,
        entity_type,
        label,
        workspace_id,
        1 - (embedding <=> ${JSON.stringify(embedding)}::vector) AS similarity
      FROM semantic_entities
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT ${topK}
    ` as EntityRow[];

    if (rows.length === 0) {
      console.log('  No indexed entities found. Run a sync first.');
      return;
    }

    const colWidth = 40;
    console.log(
      `${'SIMILARITY'.padEnd(12)}${'TYPE'.padEnd(16)}${'LABEL'.padEnd(colWidth)}WORKSPACE`
    );
    console.log('-'.repeat(12 + 16 + colWidth + 20));

    for (const row of rows) {
      const sim = row.similarity.toFixed(4);
      const score = parseFloat(sim);
      const indicator = score >= 0.92 ? '●●●' : score >= 0.70 ? '●●○' : '●○○';
      console.log(
        `${sim.padEnd(8)} ${indicator.padEnd(4)}${row.entity_type.padEnd(16)}${row.label.slice(0, colWidth - 2).padEnd(colWidth)}${row.workspace_id}`
      );
    }

    console.log('\n  Legend: ●●● ≥0.92 (cache hit quality)  ●●○ ≥0.70 (related)  ●○○ below threshold');
  } finally {
    await sql.end();
  }
}
