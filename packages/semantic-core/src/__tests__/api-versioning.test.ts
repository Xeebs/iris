import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseVersionHeader,
  compareVersions,
  isVersionSupported,
  buildDeprecationHeaders,
  generateDeprecationWarning,
  hasFeatures,
  selectBestVersion,
  ApiVersionManager,
} from '../api-versioning.js';
import type { EndpointVersion, ApiVersion } from '../api-versioning.js';

function makeEndpoint(overrides: Partial<EndpointVersion> = {}): EndpointVersion {
  return {
    path: '/api/v1/entities',
    method: 'GET',
    version: 'v1',
    status: 'active',
    deprecatedAt: null,
    sunsetAt: null,
    migrationPath: null,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<ApiVersion> = {}): ApiVersion {
  return {
    version: 'v1',
    status: 'active',
    releasedAt: new Date('2026-01-01'),
    sunsetAt: null,
    features: ['entities', 'search'],
    minClientVersion: null,
    ...overrides,
  };
}

describe('parseVersionHeader', () => {
  it('defaults to v1', () => {
    expect(parseVersionHeader(null)).toBe('v1');
    expect(parseVersionHeader(undefined)).toBe('v1');
    expect(parseVersionHeader('')).toBe('v1');
  });

  it('normalizes version string', () => {
    expect(parseVersionHeader('v2')).toBe('v2');
    expect(parseVersionHeader('2')).toBe('v2');
    expect(parseVersionHeader('V2')).toBe('v2');
  });
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('v1', 'v1')).toBe(0);
    expect(compareVersions('v2', 'v2')).toBe(0);
  });

  it('returns negative for older version', () => {
    expect(compareVersions('v1', 'v2')).toBeLessThan(0);
  });

  it('returns positive for newer version', () => {
    expect(compareVersions('v2', 'v1')).toBeGreaterThan(0);
  });
});

describe('isVersionSupported', () => {
  it('returns true when version is within range', () => {
    expect(isVersionSupported('v2', 'v1', 'v3')).toBe(true);
  });

  it('returns true at boundaries', () => {
    expect(isVersionSupported('v1', 'v1', 'v3')).toBe(true);
    expect(isVersionSupported('v3', 'v1', 'v3')).toBe(true);
  });

  it('returns false outside range', () => {
    expect(isVersionSupported('v0', 'v1', 'v3')).toBe(false);
    expect(isVersionSupported('v4', 'v1', 'v3')).toBe(false);
  });
});

describe('buildDeprecationHeaders', () => {
  it('returns empty object for active endpoint', () => {
    expect(buildDeprecationHeaders(makeEndpoint())).toEqual({});
  });

  it('includes Deprecation and Warning headers for deprecated endpoint', () => {
    const endpoint = makeEndpoint({
      status: 'deprecated',
      deprecatedAt: new Date('2026-03-01'),
      sunsetAt: new Date('2026-09-01'),
      migrationPath: '/api/v2/entities',
    });
    const headers = buildDeprecationHeaders(endpoint);
    expect(headers['Deprecation']).toBeDefined();
    expect(headers['Warning']).toMatch(/deprecated/i);
    expect(headers['Sunset']).toBeDefined();
    expect(headers['Link']).toContain('/api/v2/entities');
  });

  it('includes sunset-specific warning for sunset endpoint', () => {
    const endpoint = makeEndpoint({ status: 'sunset', deprecatedAt: new Date('2026-01-01') });
    const headers = buildDeprecationHeaders(endpoint);
    expect(headers['Warning']).toMatch(/sunset/i);
  });
});

describe('generateDeprecationWarning', () => {
  it('returns deprecated=false for active endpoints', () => {
    const w = generateDeprecationWarning(makeEndpoint());
    expect(w.deprecated).toBe(false);
  });

  it('returns deprecation details for deprecated endpoints', () => {
    const endpoint = makeEndpoint({
      status: 'deprecated',
      deprecatedAt: new Date('2026-03-01'),
      sunsetAt: new Date('2026-09-01'),
      migrationPath: '/api/v2/entities',
    });
    const w = generateDeprecationWarning(endpoint);
    expect(w.deprecated).toBe(true);
    expect(w.successor).toBe('/api/v2/entities');
    expect(w.warningHeader).toBeTruthy();
  });
});

describe('hasFeatures', () => {
  it('returns true when all required features present', () => {
    const v = makeVersion({ features: ['entities', 'search', 'streaming'] });
    expect(hasFeatures(v, ['entities', 'search'])).toBe(true);
  });

  it('returns false when a feature is missing', () => {
    const v = makeVersion({ features: ['entities'] });
    expect(hasFeatures(v, ['entities', 'streaming'])).toBe(false);
  });

  it('returns true for empty requirements', () => {
    expect(hasFeatures(makeVersion(), [])).toBe(true);
  });
});

describe('selectBestVersion', () => {
  const v1 = makeVersion({ version: 'v1', status: 'active' });
  const v2 = makeVersion({ version: 'v2', status: 'active' });
  const v3 = makeVersion({ version: 'v3', status: 'sunset' });

  it('returns null when no versions available', () => {
    expect(selectBestVersion('v2', [])).toBeNull();
  });

  it('selects the best matching version', () => {
    const result = selectBestVersion('v2', [v1, v2, v3]);
    expect(result!.version).toBe('v2');
  });

  it('falls back to lower version if requested is not available', () => {
    const result = selectBestVersion('v5', [v1, v2]);
    expect(result!.version).toBe('v2');
  });

  it('excludes sunset versions', () => {
    const result = selectBestVersion('v3', [v1, v2, v3]);
    expect(result!.version).toBe('v2');
  });
});

describe('ApiVersionManager', () => {
  let mgr: ApiVersionManager;

  beforeEach(() => {
    mgr = new ApiVersionManager();
    mgr.defineVersion(makeVersion({ version: 'v1', status: 'deprecated', sunsetAt: new Date('2026-12-01') }));
    mgr.defineVersion(makeVersion({ version: 'v2', status: 'active', features: ['entities', 'search', 'streaming'] }));
  });

  it('lists versions sorted descending', () => {
    const versions = mgr.listVersions();
    expect(versions[0]!.version).toBe('v2');
    expect(versions[1]!.version).toBe('v1');
  });

  it('lists deprecated endpoints', () => {
    mgr.defineEndpointVersion(makeEndpoint({ status: 'deprecated', migrationPath: '/api/v2/entities' }));
    mgr.defineEndpointVersion(makeEndpoint({ path: '/api/v2/entities', version: 'v2', status: 'active' }));
    expect(mgr.listDeprecatedEndpoints()).toHaveLength(1);
  });

  it('supports valid version', () => {
    const result = mgr.checkVersionSupport('v2');
    expect(result.supported).toBe(true);
  });

  it('rejects sunset version', () => {
    mgr.defineVersion(makeVersion({ version: 'v0', status: 'sunset' }));
    const result = mgr.checkVersionSupport('v0');
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/sunset/i);
  });

  it('rejects unknown version', () => {
    const result = mgr.checkVersionSupport('v99');
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/not recognized/i);
  });

  it('returns deprecation headers for deprecated endpoint', () => {
    mgr.defineEndpointVersion(makeEndpoint({
      status: 'deprecated',
      deprecatedAt: new Date('2026-03-01'),
      sunsetAt: new Date('2026-12-01'),
    }));
    const headers = mgr.getEndpointHeaders('GET', '/api/v1/entities', 'v1');
    expect(headers['Warning']).toBeDefined();
  });
});
