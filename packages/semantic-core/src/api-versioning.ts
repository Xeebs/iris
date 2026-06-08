// ─── Types ────────────────────────────────────────────────────────────────────

export type VersionStatus = 'active' | 'deprecated' | 'sunset';

export type EndpointVersion = {
  path: string;
  method: string;
  version: string;
  status: VersionStatus;
  deprecatedAt: Date | null;
  sunsetAt: Date | null;
  migrationPath: string | null;
};

export type ApiVersion = {
  version: string;
  status: VersionStatus;
  releasedAt: Date;
  sunsetAt: Date | null;
  features: string[];
  minClientVersion: string | null;
};

export type DeprecationWarning = {
  deprecated: boolean;
  deprecatedAt: Date | null;
  sunsetAt: Date | null;
  successor: string | null;
  warningHeader: string;
  sunsetHeader: string | null;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parse the X-API-Version header. Falls back to 'v1'.
 */
export function parseVersionHeader(header: string | null | undefined): string {
  if (!header) return 'v1';
  const trimmed = header.trim().toLowerCase();
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

/**
 * Compare two semver-style API versions (e.g. 'v1', 'v2', 'v1.1').
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const toNum = (v: string) => {
    const parts = v.replace(/^v/, '').split('.').map(Number);
    return (parts[0] ?? 0) * 1000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0);
  };
  return toNum(a) - toNum(b);
}

/**
 * Determine if a requested version is supported within min/max bounds.
 */
export function isVersionSupported(
  requested: string,
  minVersion: string,
  maxVersion: string,
): boolean {
  return compareVersions(requested, minVersion) >= 0 && compareVersions(requested, maxVersion) <= 0;
}

/**
 * Build deprecation response headers for a deprecated endpoint.
 */
export function buildDeprecationHeaders(endpoint: EndpointVersion): Record<string, string> {
  const headers: Record<string, string> = {};
  if (endpoint.status === 'active') return headers;

  if (endpoint.deprecatedAt) {
    headers['Deprecation'] = endpoint.deprecatedAt.toUTCString();
  }
  if (endpoint.sunsetAt) {
    headers['Sunset'] = endpoint.sunsetAt.toUTCString();
  }
  if (endpoint.migrationPath) {
    headers['Link'] = `<${endpoint.migrationPath}>; rel="successor-version"`;
  }
  const warn = endpoint.status === 'sunset'
    ? `299 iris "This endpoint is sunset. Please migrate immediately."`
    : `299 iris "This endpoint is deprecated. Migrate before ${endpoint.sunsetAt?.toUTCString() ?? 'sunset date TBD'}"`;
  headers['Warning'] = warn;
  return headers;
}

/**
 * Generate a human-readable deprecation warning object.
 */
export function generateDeprecationWarning(
  endpoint: EndpointVersion,
): DeprecationWarning {
  if (endpoint.status === 'active') {
    return { deprecated: false, deprecatedAt: null, sunsetAt: null, successor: null, warningHeader: '', sunsetHeader: null };
  }
  const headers = buildDeprecationHeaders(endpoint);
  return {
    deprecated: true,
    deprecatedAt: endpoint.deprecatedAt,
    sunsetAt: endpoint.sunsetAt,
    successor: endpoint.migrationPath,
    warningHeader: headers['Warning'] ?? '',
    sunsetHeader: headers['Sunset'] ?? null,
  };
}

/**
 * Check if a given API version has all required features.
 */
export function hasFeatures(version: ApiVersion, requiredFeatures: string[]): boolean {
  return requiredFeatures.every((f) => version.features.includes(f));
}

/**
 * Select the best version from a list given a requested version string.
 * Returns the closest active/deprecated version <= requested.
 */
export function selectBestVersion(
  requested: string,
  available: ApiVersion[],
): ApiVersion | null {
  const eligible = available
    .filter((v) => v.status !== 'sunset' && compareVersions(v.version, requested) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  return eligible[0] ?? null;
}

// ─── ApiVersionManager ────────────────────────────────────────────────────────

export class ApiVersionManager {
  private readonly versions = new Map<string, ApiVersion>();
  private readonly endpoints = new Map<string, EndpointVersion>();

  /** Register a known API version. */
  defineVersion(version: ApiVersion): void {
    this.versions.set(version.version, version);
  }

  /** Register an endpoint's version metadata. */
  defineEndpointVersion(endpoint: EndpointVersion): void {
    this.endpoints.set(`${endpoint.method}:${endpoint.path}:${endpoint.version}`, endpoint);
  }

  /** Look up a version definition. */
  getVersion(version: string): ApiVersion | undefined {
    return this.versions.get(version);
  }

  /** Get all registered versions sorted descending. */
  listVersions(): ApiVersion[] {
    return [...this.versions.values()].sort((a, b) => compareVersions(b.version, a.version));
  }

  /** Get all deprecated or sunset endpoints. */
  listDeprecatedEndpoints(): EndpointVersion[] {
    return [...this.endpoints.values()].filter((e) => e.status !== 'active');
  }

  /** Check if version is supported within the registered min/max range. */
  checkVersionSupport(requested: string): { supported: boolean; reason?: string } {
    const all = this.listVersions();
    if (all.length === 0) return { supported: true };
    const min = all[all.length - 1]!.version;
    const max = all[0]!.version;
    const v = this.versions.get(requested);
    if (!v) return { supported: false, reason: `Version ${requested} is not recognized` };
    if (v.status === 'sunset') return { supported: false, reason: `Version ${requested} has been sunset` };
    if (!isVersionSupported(requested, min, max)) {
      return { supported: false, reason: `Version ${requested} is outside supported range ${min}–${max}` };
    }
    return { supported: true };
  }

  /** Get deprecation headers for a specific endpoint+version combo. */
  getEndpointHeaders(method: string, path: string, version: string): Record<string, string> {
    const key = `${method}:${path}:${version}`;
    const endpoint = this.endpoints.get(key);
    if (!endpoint) return {};
    return buildDeprecationHeaders(endpoint);
  }
}
