import { describe, it, expect, vi, afterEach } from 'vitest';

import type { SemanticEntity } from '@iris/connector-sdk';

import { HubSpotConnector } from '../hubspot-connector.js';

const DEMO_CONFIG = { portalId: 'demo-portal', demoMode: true };

async function syncAll(connector: HubSpotConnector): Promise<SemanticEntity[]> {
  const entities: SemanticEntity[] = [];
  for await (const entity of connector.sync({})) {
    entities.push(entity);
  }
  return entities;
}

async function connectedDemoConnector(): Promise<HubSpotConnector> {
  const connector = new HubSpotConnector();
  const result = await connector.connect(DEMO_CONFIG);
  expect(result.isOk()).toBe(true);
  return connector;
}

describe('HubSpotConnector demo mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect()', () => {
    it('succeeds without OAuth tokens when demoMode is true', async () => {
      const connector = new HubSpotConnector();
      const result = await connector.connect(DEMO_CONFIG);
      expect(result.isOk()).toBe(true);
    });

    it('still requires tokens when demoMode is absent', async () => {
      const connector = new HubSpotConnector();
      const result = await connector.connect({ portalId: 'demo-portal' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync()', () => {
    it('performs a full sync from fixtures without any network calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const connector = await connectedDemoConnector();
      const entities = await syncAll(connector);

      expect(entities).toHaveLength(22);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('yields expected counts per entity type', async () => {
      const entities = await syncAll(await connectedDemoConnector());
      const byType = (t: string) => entities.filter((e) => e.type === t);
      expect(byType('contact')).toHaveLength(8);
      expect(byType('company')).toHaveLength(4);
      expect(byType('deal')).toHaveLength(10);
    });
  });

  describe('canonical question facts (docs/VERTICAL_SLICE.md)', () => {
    it('Q1: has exactly 3 open deals with a total value of 195000', async () => {
      const entities = await syncAll(await connectedDemoConnector());
      const openDeals = entities.filter(
        (e) => e.type === 'deal' && e.attributes['stage'] !== 'closedwon' && e.attributes['stage'] !== 'closedlost',
      );
      expect(openDeals).toHaveLength(3);
      const total = openDeals.reduce((sum, d) => sum + Number(d.attributes['amount']), 0);
      expect(total).toBe(195000);
    });

    it('Q2: Alice Smith works for Acme Corp', async () => {
      const entities = await syncAll(await connectedDemoConnector());
      const alice = entities.find((e) => e.label === 'Alice Smith');
      expect(alice?.attributes['company']).toBe('Acme Corp');
      expect(alice?.relationships[0]?.targetId).toBe('hubspot:company:2001');
    });

    it('Q3: negotiation-stage deals are Acme Annual Contract and Globex Pilot Expansion', async () => {
      const entities = await syncAll(await connectedDemoConnector());
      const negotiating = entities
        .filter((e) => e.type === 'deal' && e.attributes['stage'] === 'negotiation')
        .map((e) => e.label)
        .sort();
      expect(negotiating).toEqual(['Acme Annual Contract', 'Globex Pilot Expansion']);
    });

    it('Q4: the largest deal is Acme Annual Contract owned by owner 50', async () => {
      const entities = await syncAll(await connectedDemoConnector());
      const deals = entities.filter((e) => e.type === 'deal');
      const largest = deals.reduce((max, d) =>
        Number(d.attributes['amount'] ?? 0) > Number(max.attributes['amount'] ?? 0) ? d : max,
      );
      expect(largest.label).toBe('Acme Annual Contract');
      expect(largest.attributes['owner']).toBe('50');
    });

    it('Q5: Acme Corp contacts are Alice Smith and Carol White', async () => {
      const entities = await syncAll(await connectedDemoConnector());
      const acmeContacts = entities
        .filter((e) => e.type === 'contact' && e.attributes['company'] === 'Acme Corp')
        .map((e) => e.label)
        .sort();
      expect(acmeContacts).toEqual(['Alice Smith', 'Carol White']);
    });
  });

  describe('healthCheck()', () => {
    it('reports healthy in demo mode without network', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const connector = await connectedDemoConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
