import { readFile } from 'node:fs/promises';

import { ConnectorError } from '@iris/connector-sdk';

/**
 * Fixture-backed stand-in for the HubSpot HTTP layer, used when the
 * connector config has `demoMode: true`. Resolves the same CRM v3 object
 * paths the live client calls, returning the JSON fixture page instead.
 * Fixtures live in tests/fixtures/ — one level up from both src/ and dist/,
 * so the URL resolution works for source and built output alike.
 */
const FIXTURES_BY_OBJECT: Record<string, URL> = {
  contacts: new URL('../tests/fixtures/contacts.json', import.meta.url),
  companies: new URL('../tests/fixtures/companies.json', import.meta.url),
  deals: new URL('../tests/fixtures/deals.json', import.meta.url),
};

const OBJECT_PATH_PATTERN = /^\/crm\/v3\/objects\/(contacts|companies|deals)(?:\?|$)/;

/**
 * Resolve a HubSpot CRM API path to its fixture page.
 *
 * @param path - Request path as passed to the live client (e.g. `/crm/v3/objects/deals?limit=100`)
 * @returns Parsed fixture JSON in the live API's list-response shape
 */
export async function fetchFixturePage<T>(path: string): Promise<T> {
  const match = OBJECT_PATH_PATTERN.exec(path);
  if (!match) {
    throw new ConnectorError(`No fixture for HubSpot path: ${path}`, 'API_ERROR', false);
  }

  const raw = await readFile(FIXTURES_BY_OBJECT[match[1]!]!, 'utf8');
  return JSON.parse(raw) as T;
}
