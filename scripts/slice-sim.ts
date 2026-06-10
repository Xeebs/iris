/**
 * Offline simulation of the slice-demo MCP query phase.
 *
 * The demo's retrieval is fully deterministic (hash-deterministic embeddings,
 * BM25 returns no rows for the canonical questions because plainto_tsquery
 * ANDs all terms against a label+type-only tsvector), so the entire ranking
 * and response assembly can be reproduced without Postgres. Used to verify
 * retrieval changes against the CI acceptance gates (facts + ≥70% savings)
 * before pushing, since the Pi cannot run the real demo.
 *
 * Usage: node --import tsx scripts/slice-sim.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { transformContact, transformCompany, transformDeal } from '../packages/connectors/hubspot/src/transformers.js';
import { buildEmbeddingInput } from '../packages/semantic-core/src/embedding.js';
import { DeterministicHashProvider } from '../packages/semantic-core/src/providers/deterministic-hash-provider.js';
import { compress } from '../packages/compression/src/pipeline.js';
import type { SemanticEntity } from '../packages/connector-sdk/src/base-connector.js';

const FIXTURES = join(import.meta.dirname ?? '.', '..', 'packages', 'connectors', 'hubspot', 'tests', 'fixtures');

type FixturePage<T> = { results: T[] };
function loadFixture<T>(name: string): T[] {
  return (JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as FixturePage<T>).results;
}

const QUESTIONS = [
  { q: 'How many open deals do we have, and what is their total value?', facts: ['Acme Annual Contract', '120000', 'Globex Pilot Expansion', '45000', 'Acme Cloud Migration', '30000'], baseline: 'deals.json' },
  { q: 'Which company does Alice Smith work for?', facts: ['Alice Smith', 'Acme Corp'], baseline: 'contacts.json,companies.json' },
  { q: 'List our deals in the negotiation stage.', facts: ['negotiation', 'Acme Annual Contract', 'Globex Pilot Expansion'], baseline: 'deals.json' },
  { q: 'Who is the owner of our largest deal?', facts: ['Acme Annual Contract', '120000', 'owner: 50'], baseline: 'deals.json' },
  { q: 'Which contacts belong to Acme Corp?', facts: ['Alice Smith', 'Carol White'], baseline: 'contacts.json,companies.json' },
];

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // both L2-normalized
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main(): Promise<void> {
  // Sync order matches the connector: contacts, companies, deals.
  const entities: SemanticEntity[] = [
    ...loadFixture<Parameters<typeof transformContact>[0]>('contacts.json').map(transformContact),
    ...loadFixture<Parameters<typeof transformCompany>[0]>('companies.json').map(transformCompany),
    ...loadFixture<Parameters<typeof transformDeal>[0]>('deals.json').map(transformDeal),
  ];

  const provider = new DeterministicHashProvider();
  const vectors = await provider.batchEmbeddings(entities.map((e) => buildEmbeddingInput(e)));
  const byId = new Map(entities.map((e, i) => [e.id, i]));

  const topK = Number(process.env['SIM_TOPK'] ?? 10);
  const cutoff = Number(process.env['SIM_CUTOFF'] ?? 0); // relative-to-top score floor, 0 = off

  let totalIris = 0;
  let totalBaseline = 0;
  let failures = 0;

  for (const { q, facts, baseline } of QUESTIONS) {
    const qv = await provider.getEmbedding(q);
    const ranked = entities
      .map((e, i) => ({ e, i, score: cosine(qv, vectors[i]!) }))
      .sort((a, b) => b.score - a.score || a.i - b.i);

    // Mirror retrieveContext: vector search fetches topK*2, the relevance
    // cutoff applies per source list, RRF (BM25 list is empty for these
    // queries) preserves order, then the merged list is sliced to topK.
    let hits = ranked.slice(0, topK * 2);
    if (cutoff > 0 && hits.length > 0) {
      const top = hits[0]!.score;
      hits = hits.filter((h, i) => i === 0 || h.score > top * cutoff);
    }
    hits = hits.slice(0, topK);

    // Relationship expansion (maxDepth 1): append belongs_to targets not already present.
    const seen = new Set(hits.map((h) => h.e.id));
    const expanded = hits.map((h) => h.e);
    for (const h of hits) {
      for (const rel of h.e.relationships) {
        if (seen.has(rel.targetId)) continue;
        const idx = byId.get(rel.targetId);
        if (idx !== undefined) {
          expanded.push(entities[idx]!);
          seen.add(rel.targetId);
        }
      }
    }

    const { content } = compress(expanded, { contextBudget: 2000, query: q });
    const tokens = estimateTokens(content);
    const baseTokens = baseline.split(',').reduce((s, f) => s + estimateTokens(readFileSync(join(FIXTURES, f), 'utf8')), 0);
    const missing = facts.filter((f) => !content.includes(f));
    totalIris += tokens;
    totalBaseline += baseTokens;
    if (missing.length > 0) failures++;

    const savings = ((1 - tokens / baseTokens) * 100).toFixed(1);
    console.log(
      `${missing.length === 0 ? 'PASS' : 'FAIL'} (~${tokens} vs ${baseTokens} raw, ${savings}% saved, ${expanded.length} entities): ${q}` +
        (missing.length > 0 ? `\n  missing: ${JSON.stringify(missing)}` : ''),
    );
    if (process.env['SIM_VERBOSE']) {
      for (const h of ranked.slice(0, Math.max(topK, 12))) {
        console.log(`    ${h.score.toFixed(4)}  ${h.e.type}  ${h.e.label}`);
      }
    }
  }

  const overall = ((1 - totalIris / totalBaseline) * 100).toFixed(1);
  console.log(`\nTOTAL: ${totalIris} vs ${totalBaseline} raw — ${overall}% saved; fact failures: ${failures}`);
  console.log(`(gates: 0 fact failures, >= 70% savings)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
