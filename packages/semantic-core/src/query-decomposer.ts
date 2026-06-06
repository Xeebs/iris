import OpenAI from 'openai';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-decomposer' });

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'that', 'this', 'these', 'those',
  'i', 'we', 'you', 'he', 'she', 'it', 'they', 'me', 'us', 'him', 'her',
  'them', 'my', 'our', 'your', 'his', 'its', 'their', 'what', 'which',
  'who', 'when', 'where', 'why', 'how', 'all', 'from', 'about', 'show',
  'get', 'list', 'give', 'tell', 'find', 'looking', 'need', 'want', 'any',
]);

const ENTITY_TYPE_KEYWORDS: Record<string, string[]> = {
  contact:  ['contact', 'contacts', 'person', 'people', 'customer', 'customers', 'prospect', 'lead', 'leads'],
  company:  ['company', 'companies', 'account', 'accounts', 'organization', 'organizations', 'firm', 'client', 'clients'],
  deal:     ['deal', 'deals', 'opportunity', 'opportunities', 'sale', 'sales', 'pipeline'],
  issue:    ['issue', 'issues', 'ticket', 'tickets', 'bug', 'bugs', 'task', 'tasks', 'story', 'stories', 'jira'],
  project:  ['project', 'projects', 'sprint', 'sprints', 'epic', 'epics', 'board'],
  page:     ['page', 'pages', 'document', 'documents', 'wiki', 'doc', 'docs', 'note', 'notes', 'confluence'],
  channel:  ['channel', 'channels', 'conversation', 'message', 'messages', 'thread', 'slack'],
  user:     ['user', 'users', 'member', 'members', 'employee', 'employees', 'staff', 'teammate'],
  file:     ['file', 'files', 'attachment', 'attachments', 'drive'],
  record:   ['record', 'records', 'row', 'rows', 'entry', 'entries'],
  base:     ['base', 'bases', 'airtable', 'spreadsheet', 'table'],
};

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  sales:       ['revenue', 'deal', 'opportunity', 'quota', 'close', 'pipeline', 'forecast', 'booking', 'mrr', 'arr'],
  finance:     ['budget', 'cost', 'expense', 'invoice', 'payment', 'finance', 'accounting', 'profit', 'margin'],
  hr:          ['employee', 'hire', 'onboard', 'performance', 'headcount', 'org', 'role', 'department', 'team'],
  engineering: ['bug', 'sprint', 'release', 'deploy', 'code', 'pr', 'review', 'incident', 'uptime'],
  support:     ['ticket', 'customer', 'issue', 'resolution', 'sla', 'csat', 'feedback'],
  marketing:   ['campaign', 'lead', 'channel', 'conversion', 'funnel', 'impression', 'ctr', 'roi'],
};

const detectionCache = new Map<string, string[]>();

export type DomainAnalysis = {
  domain: string | null;
  keywords: string[];
};

/**
 * Detect entity types mentioned or implied by a natural language query.
 * Uses keyword matching first; falls back to a gpt-4o-mini call when no keywords match
 * and an API key is provided. Results are cached in-process.
 *
 * @param query          - Natural language query string
 * @param availableTypes - Entity types registered in this workspace's connectors
 * @param openAiApiKey   - Optional OpenAI key for LLM fallback detection
 * @returns Subset of availableTypes that match the query; full list if no match found
 */
export async function detectEntityTypes(
  query: string,
  availableTypes: string[],
  openAiApiKey?: string,
): Promise<string[]> {
  if (availableTypes.length === 0) return [];

  const cacheKey = `${query.toLowerCase()}|${[...availableTypes].sort().join(',')}`;
  const cached = detectionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tokens = tokenize(query);
  const keywordMatches = matchByKeywords(tokens, availableTypes);

  if (keywordMatches.length > 0) {
    detectionCache.set(cacheKey, keywordMatches);
    log.debug('Entity types matched by keywords', { types: keywordMatches });
    return keywordMatches;
  }

  if (openAiApiKey) {
    const llmResult = await detectViaLlm(query, availableTypes, openAiApiKey);
    detectionCache.set(cacheKey, llmResult);
    log.debug('Entity types matched by LLM', { types: llmResult });
    return llmResult;
  }

  // No signal — return all available types so nothing is filtered out
  detectionCache.set(cacheKey, availableTypes);
  return availableTypes;
}

/**
 * Extract the most likely data domain and relevant keywords from a query.
 * Pure, synchronous — no API calls.
 *
 * @param query - Natural language query string
 */
export function getDomainKeywords(query: string): DomainAnalysis {
  const tokens = tokenize(query);
  const keywords = tokens.filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  let detectedDomain: string | null = null;
  let maxScore = 0;

  for (const [domain, domainWords] of Object.entries(DOMAIN_KEYWORDS)) {
    const score = tokens.filter((t) => domainWords.includes(t)).length;
    if (score > maxScore) {
      maxScore = score;
      detectedDomain = domain;
    }
  }

  return { domain: maxScore > 0 ? detectedDomain : null, keywords };
}

/** Clear the in-memory detection cache. Use in tests or after schema changes. */
export function clearDetectionCache(): void {
  detectionCache.clear();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function matchByKeywords(tokens: string[], availableTypes: string[]): string[] {
  const availableSet = new Set(availableTypes);
  const matched = new Set<string>();

  for (const token of tokens) {
    if (availableSet.has(token)) {
      matched.add(token);
      continue;
    }
    for (const [entityType, synonyms] of Object.entries(ENTITY_TYPE_KEYWORDS)) {
      if (availableSet.has(entityType) && synonyms.includes(token)) {
        matched.add(entityType);
      }
    }
  }

  return [...matched];
}

async function detectViaLlm(
  query: string,
  availableTypes: string[],
  apiKey: string,
): Promise<string[]> {
  const client = new OpenAI({ apiKey });
  const prompt = [
    `Query: "${query}"`,
    `Available entity types: ${availableTypes.join(', ')}`,
    'Which entity types does this query reference or imply?',
    'Respond with a JSON array containing only strings from the available list. Example: ["contact","deal"]',
  ].join('\n');

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 80,
    });
    const text = response.choices[0]?.message.content ?? '[]';
    const jsonMatch = text.match(/\[.*?\]/s);
    const parsed = JSON.parse(jsonMatch?.[0] ?? '[]') as unknown[];
    const valid = parsed.filter((t): t is string => typeof t === 'string' && availableTypes.includes(t));
    return valid.length > 0 ? valid : availableTypes;
  } catch (e) {
    log.warn('LLM entity type detection failed, using all available types', {
      error: e instanceof Error ? e.message : String(e),
    });
    return availableTypes;
  }
}
