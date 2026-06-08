import { logger } from '@iris/core/logger';
import type { EnrichmentData, EnrichmentSource } from '../enrichment-engine.js';

const log = logger.child({ service: 'person-enricher' });

const ENRICHMENT_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days (person data changes more often)

export interface PersonEnricherConfig {
  /** Optional Clearbit Person API key. Falls back to email-domain heuristics. */
  clearbitApiKey?: string;
  /** HTTP fetch implementation (injected for testability). */
  fetch?: typeof globalThis.fetch;
}

interface ClearbitPerson {
  name?: { fullName?: string };
  employment?: { title?: string; company?: string; domain?: string; seniority?: string };
  linkedin?: { handle?: string };
  location?: string;
  bio?: string;
}

/**
 * Enriches person/contact entities with professional profile data.
 * Derives company domain from email when no API key is present.
 */
export class PersonEnricher implements EnrichmentSource {
  readonly sourceId = 'person-enricher';
  readonly name = 'Person Enricher';

  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly config: PersonEnricherConfig = {}) {
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Fetch professional profile for a person entity.
   *
   * @param entityId - Entity ID
   * @param entityAttributes - Must contain `email` for any enrichment
   */
  async fetchEnrichmentData(
    entityId: string,
    entityAttributes: Record<string, unknown>,
  ): Promise<EnrichmentData | null> {
    const email = extractEmail(entityAttributes);
    if (!email) {
      log.debug('PersonEnricher: no email available', { entityId });
      return null;
    }

    const profile = this.config.clearbitApiKey
      ? await this.fetchFromClearbit(email)
      : deriveFromEmail(email);

    if (!profile) return null;

    const now = new Date();
    return {
      source: this.sourceId,
      data: profile,
      confidenceScore: this.config.clearbitApiKey ? 0.85 : 0.35,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + ENRICHMENT_TTL_MS),
    };
  }

  private async fetchFromClearbit(email: string): Promise<Record<string, unknown> | null> {
    try {
      const url = `https://person.clearbit.com/v2/people/find?email=${encodeURIComponent(email)}`;
      const res = await this.fetch(url, {
        headers: { Authorization: `Bearer ${this.config.clearbitApiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 404 || res.status === 202) return null;
      if (!res.ok) {
        log.warn('Clearbit Person API error', { email, status: res.status });
        return null;
      }

      const body = (await res.json()) as ClearbitPerson;
      return {
        companyDomain: body.employment?.domain ?? emailDomain(email),
        companyName: body.employment?.company ?? null,
        jobTitle: body.employment?.title ?? null,
        seniority: body.employment?.seniority ?? null,
        linkedinHandle: body.linkedin?.handle ?? null,
        location: body.location ?? null,
        bio: body.bio ?? null,
      };
    } catch (e) {
      log.warn('Clearbit Person fetch failed', { email, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
}

function extractEmail(attributes: Record<string, unknown>): string | null {
  const email = attributes['email'];
  if (typeof email === 'string' && email.includes('@')) return email.toLowerCase();
  return null;
}

function emailDomain(email: string): string {
  return email.split('@')[1] ?? '';
}

function deriveFromEmail(email: string): Record<string, unknown> {
  return { companyDomain: emailDomain(email), companyName: null, jobTitle: null };
}
