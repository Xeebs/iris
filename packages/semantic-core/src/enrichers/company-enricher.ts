import { logger } from '@iris/core/logger';
import type { EnrichmentData, EnrichmentSource } from '../enrichment-engine.js';

const log = logger.child({ service: 'company-enricher' });

const ENRICHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CompanyEnricherConfig {
  /** Optional Clearbit API key. When absent, uses domain-derived heuristics only. */
  clearbitApiKey?: string;
  /** HTTP fetch implementation (injected for testability). */
  fetch?: typeof globalThis.fetch;
}

interface ClearbitCompany {
  name?: string;
  domain?: string;
  description?: string;
  foundedYear?: number;
  employees?: number;
  industry?: string;
  location?: { country?: string; city?: string };
  tags?: string[];
}

/**
 * Enriches company entities with firmographic data (industry, employee count, location).
 * Uses Clearbit Enrichment API when an API key is configured; falls back to domain heuristics.
 */
export class CompanyEnricher implements EnrichmentSource {
  readonly sourceId = 'company-enricher';
  readonly name = 'Company Enricher';

  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly config: CompanyEnricherConfig = {}) {
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Fetch firmographic data for a company entity.
   *
   * @param entityId - Entity ID (unused; attributes supply the domain/name)
   * @param entityAttributes - Must contain `domain` or `name` for lookup
   */
  async fetchEnrichmentData(
    entityId: string,
    entityAttributes: Record<string, unknown>,
  ): Promise<EnrichmentData | null> {
    const domain = extractDomain(entityAttributes);
    if (!domain) {
      log.debug('CompanyEnricher: no domain available', { entityId });
      return null;
    }

    const firmographics = this.config.clearbitApiKey
      ? await this.fetchFromClearbit(domain)
      : deriveFromDomain(domain);

    if (!firmographics) return null;

    const now = new Date();
    return {
      source: this.sourceId,
      data: firmographics,
      confidenceScore: this.config.clearbitApiKey ? 0.9 : 0.4,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + ENRICHMENT_TTL_MS),
    };
  }

  private async fetchFromClearbit(domain: string): Promise<Record<string, unknown> | null> {
    try {
      const url = `https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(domain)}`;
      const res = await this.fetch(url, {
        headers: { Authorization: `Bearer ${this.config.clearbitApiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 404) return null;
      if (!res.ok) {
        log.warn('Clearbit API error', { domain, status: res.status });
        return null;
      }

      const body = (await res.json()) as ClearbitCompany;
      return {
        domain,
        industry: body.industry ?? null,
        employeeCount: body.employees ?? null,
        foundedYear: body.foundedYear ?? null,
        country: body.location?.country ?? null,
        city: body.location?.city ?? null,
        description: body.description ?? null,
        tags: body.tags ?? [],
      };
    } catch (e) {
      log.warn('Clearbit fetch failed', { domain, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
}

function extractDomain(attributes: Record<string, unknown>): string | null {
  const domain = attributes['domain'] ?? attributes['website'] ?? attributes['email'];
  if (typeof domain === 'string' && domain.length > 0) {
    const cleaned = domain
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (cleaned.includes('.')) return cleaned;
  }
  return null;
}

function deriveFromDomain(domain: string): Record<string, unknown> {
  return { domain, industry: null, employeeCount: null, foundedYear: null };
}
