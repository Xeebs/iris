import { logger } from '@iris/core/logger';
import type { EnrichmentData, EnrichmentSource } from '../enrichment-engine.js';

const log = logger.child({ service: 'sentiment-enricher' });

const ENRICHMENT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (news is time-sensitive)

export interface SentimentEnricherConfig {
  /** News API key (newsapi.org). Required for real enrichment. */
  newsApiKey?: string;
  /** HTTP fetch implementation (injected for testability). */
  fetch?: typeof globalThis.fetch;
}

interface NewsApiArticle {
  title: string;
  description?: string;
  publishedAt: string;
  source?: { name?: string };
  url?: string;
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

/**
 * Enriches entities with recent news mentions and derived sentiment signal.
 * Uses NewsAPI to fetch recent headlines mentioning the entity label.
 */
export class SentimentEnricher implements EnrichmentSource {
  readonly sourceId = 'sentiment-enricher';
  readonly name = 'Sentiment Enricher';

  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly config: SentimentEnricherConfig = {}) {
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Fetch recent news sentiment for an entity.
   *
   * @param entityId - Entity ID (unused here; label from attributes used)
   * @param entityAttributes - Must contain `name` or `label` for the search query
   */
  async fetchEnrichmentData(
    entityId: string,
    entityAttributes: Record<string, unknown>,
  ): Promise<EnrichmentData | null> {
    const query = extractSearchQuery(entityAttributes);
    if (!query || !this.config.newsApiKey) {
      log.debug('SentimentEnricher: no query or API key', { entityId });
      return null;
    }

    const articles = await this.fetchRecentArticles(query);
    if (articles === null) return null;

    const sentiment = deriveSentiment(articles);
    const now = new Date();

    return {
      source: this.sourceId,
      data: {
        query,
        recentMentionCount: articles.length,
        sentiment,
        recentHeadlines: articles.slice(0, 5).map((a) => ({
          title: a.title,
          publishedAt: a.publishedAt,
          source: a.source?.name ?? null,
        })),
      },
      confidenceScore: articles.length >= 3 ? 0.7 : 0.4,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + ENRICHMENT_TTL_MS),
    };
  }

  private async fetchRecentArticles(query: string): Promise<NewsApiArticle[] | null> {
    try {
      const url = new URL('https://newsapi.org/v2/everything');
      url.searchParams.set('q', query);
      url.searchParams.set('sortBy', 'publishedAt');
      url.searchParams.set('pageSize', '20');
      url.searchParams.set('language', 'en');

      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      url.searchParams.set('from', from.toISOString().slice(0, 10));

      const res = await this.fetch(url.toString(), {
        headers: { 'X-Api-Key': this.config.newsApiKey! },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        log.warn('NewsAPI error', { query, status: res.status });
        return null;
      }

      const body = (await res.json()) as NewsApiResponse;
      return body.articles ?? [];
    } catch (e) {
      log.warn('NewsAPI fetch failed', { query, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
}

function extractSearchQuery(attributes: Record<string, unknown>): string | null {
  const name = attributes['name'] ?? attributes['label'] ?? attributes['company'];
  if (typeof name === 'string' && name.trim().length > 2) return name.trim();
  return null;
}

function deriveSentiment(articles: NewsApiArticle[]): 'positive' | 'neutral' | 'negative' | 'unknown' {
  if (articles.length === 0) return 'unknown';

  const positiveTerms = /growth|record|profit|award|launch|partnership|expansion|success|leader/i;
  const negativeTerms = /lawsuit|scandal|layoff|bankruptcy|loss|decline|fine|breach|controversy/i;

  let pos = 0;
  let neg = 0;

  for (const article of articles) {
    const text = `${article.title} ${article.description ?? ''}`;
    if (positiveTerms.test(text)) pos++;
    if (negativeTerms.test(text)) neg++;
  }

  if (pos > neg * 1.5) return 'positive';
  if (neg > pos * 1.5) return 'negative';
  return 'neutral';
}
