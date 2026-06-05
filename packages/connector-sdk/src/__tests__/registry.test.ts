import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ConnectorRegistry } from '../registry.js';
import { ConnectorError } from '../base-connector.js';
import type { ConnectorManifest } from '../base-connector.js';

const hubspotManifest: ConnectorManifest = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM contacts, companies, and deals',
  icon: 'hubspot.svg',
  auth: { type: 'oauth2', scopes: ['contacts'] },
  entityTypes: ['contact', 'company', 'deal'],
  configSchema: z.object({ portalId: z.string().min(1) }),
  rateLimits: { requestsPerSecond: 10 },
};

const notionManifest: ConnectorManifest = {
  id: 'notion',
  name: 'Notion',
  description: 'Notion pages and databases',
  icon: 'notion.svg',
  auth: { type: 'oauth2', scopes: ['read_content'] },
  entityTypes: ['page', 'database'],
  configSchema: z.object({}),
  rateLimits: { requestsPerSecond: 3 },
};

const noopFactory = () => {
  throw new Error('not implemented');
};

describe('ConnectorRegistry', () => {
  let reg: ConnectorRegistry;

  beforeEach(() => {
    reg = new ConnectorRegistry();
  });

  describe('register', () => {
    it('registers a connector and makes it findable', () => {
      reg.register({ manifest: hubspotManifest, factory: noopFactory });
      expect(reg.has('hubspot')).toBe(true);
    });

    it('throws on duplicate registration', () => {
      reg.register({ manifest: hubspotManifest, factory: noopFactory });
      expect(() =>
        reg.register({ manifest: hubspotManifest, factory: noopFactory }),
      ).toThrow(ConnectorError);
    });
  });

  describe('get', () => {
    it('returns the registration for a known connector', () => {
      reg.register({ manifest: hubspotManifest, factory: noopFactory });
      const found = reg.get('hubspot');
      expect(found.manifest.id).toBe('hubspot');
    });

    it('throws ConnectorError for unknown connector', () => {
      expect(() => reg.get('unknown')).toThrow(ConnectorError);
    });
  });

  describe('list', () => {
    it('returns all registered manifests', () => {
      reg.register({ manifest: hubspotManifest, factory: noopFactory });
      reg.register({ manifest: notionManifest, factory: noopFactory });
      const manifests = reg.list();
      expect(manifests).toHaveLength(2);
      expect(manifests.map((m) => m.id)).toContain('hubspot');
      expect(manifests.map((m) => m.id)).toContain('notion');
    });

    it('returns empty array when no connectors registered', () => {
      expect(reg.list()).toEqual([]);
    });
  });

  describe('validateConfig', () => {
    beforeEach(() => {
      reg.register({ manifest: hubspotManifest, factory: noopFactory });
      reg.register({ manifest: notionManifest, factory: noopFactory });
    });

    it('returns parsed config for valid input', () => {
      const parsed = reg.validateConfig('hubspot', { portalId: '12345' });
      expect((parsed as { portalId: string }).portalId).toBe('12345');
    });

    it('throws ConnectorError for invalid config', () => {
      expect(() => reg.validateConfig('hubspot', {})).toThrow(ConnectorError);
    });

    it('throws ConnectorError with details about the invalid field', () => {
      try {
        reg.validateConfig('hubspot', { portalId: '' });
      } catch (e) {
        expect(e).toBeInstanceOf(ConnectorError);
        expect((e as ConnectorError).message).toContain('portalId');
      }
    });

    it('accepts valid config for connector with empty schema', () => {
      expect(() => reg.validateConfig('notion', {})).not.toThrow();
    });

    it('throws ConnectorError when connector is not registered', () => {
      expect(() => reg.validateConfig('unknown', {})).toThrow(ConnectorError);
    });
  });

  describe('size', () => {
    it('tracks the number of registered connectors', () => {
      expect(reg.size).toBe(0);
      reg.register({ manifest: hubspotManifest, factory: noopFactory });
      expect(reg.size).toBe(1);
      reg.register({ manifest: notionManifest, factory: noopFactory });
      expect(reg.size).toBe(2);
    });
  });
});
