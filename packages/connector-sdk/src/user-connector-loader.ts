import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

import type { ConnectorManifest, BaseConnector, SemanticEntity } from './base-connector.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Simplified connector definition a user provides in their module. */
export interface CustomConnectorDefinition<TConfig = unknown> {
  manifest: ConnectorManifest;
  createConnector: (config: TConfig) => BaseConnector<TConfig, SemanticEntity>;
}

/** Result of loading and validating a user connector. */
export interface ConnectorLoadResult {
  valid: boolean;
  definition?: CustomConnectorDefinition;
  errors: string[];
}

// ─── Required method names every connector module must export ─────────────────

const REQUIRED_METHODS = ['connect', 'sync', 'getSchema', 'healthCheck'] as const;

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * @param def - Object to validate as a CustomConnectorDefinition
 * @returns Array of validation error messages (empty = valid)
 */
export function validateConnectorDefinition(def: unknown): string[] {
  const errors: string[] = [];

  if (typeof def !== 'object' || def === null) {
    return ['Module default export must be an object'];
  }

  const d = def as Record<string, unknown>;

  // Validate manifest
  if (!d['manifest'] || typeof d['manifest'] !== 'object') {
    errors.push('Missing or invalid "manifest" export');
  } else {
    const m = d['manifest'] as Record<string, unknown>;
    if (typeof m['id'] !== 'string' || m['id'].trim() === '') {
      errors.push('manifest.id must be a non-empty string');
    }
    if (typeof m['name'] !== 'string' || m['name'].trim() === '') {
      errors.push('manifest.name must be a non-empty string');
    }
    if (!m['configSchema'] || typeof m['configSchema'] !== 'object') {
      errors.push('manifest.configSchema must be a Zod schema object');
    }
    if (!Array.isArray(m['entityTypes']) || m['entityTypes'].length === 0) {
      errors.push('manifest.entityTypes must be a non-empty array');
    }
  }

  // Validate createConnector factory
  if (typeof d['createConnector'] !== 'function') {
    errors.push('Missing or invalid "createConnector" export (must be a function)');
  } else {
    // Try calling with a dummy config to get the connector instance and verify methods
    try {
      const instance = (d['createConnector'] as (c: unknown) => unknown)({});
      if (typeof instance !== 'object' || instance === null) {
        errors.push('createConnector() must return an object');
      } else {
        const inst = instance as Record<string, unknown>;
        for (const method of REQUIRED_METHODS) {
          if (typeof inst[method] !== 'function') {
            errors.push(`Connector instance must implement method: ${method}()`);
          }
        }
      }
    } catch (e) {
      errors.push(
        `createConnector() threw during validation: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return errors;
}

/**
 * Dynamically import a connector module from a filesystem path.
 * The module must export a default or named `definition` matching
 * CustomConnectorDefinition.
 *
 * @param connectorPath - Absolute path to the connector's entry JS/TS file
 * @returns Load result with validation errors if invalid
 */
export async function loadUserConnector(connectorPath: string): Promise<ConnectorLoadResult> {
  const absolute = path.resolve(connectorPath);

  // Verify file exists
  try {
    await fs.access(absolute);
  } catch {
    return { valid: false, errors: [`Connector file not found: ${absolute}`] };
  }

  let mod: unknown;
  try {
    const fileUrl = pathToFileURL(absolute).href;
    mod = await import(fileUrl);
  } catch (e) {
    return {
      valid: false,
      errors: [`Failed to import connector module: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  // Accept default export or named `definition` export
  const def =
    (mod as Record<string, unknown>)['default'] ??
    (mod as Record<string, unknown>)['definition'];

  const errors = validateConnectorDefinition(def);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    definition: def as CustomConnectorDefinition,
    errors: [],
  };
}

/**
 * Scan a directory for connector entry files (index.js or connector.js).
 *
 * @param dirPath - Directory to scan
 * @returns List of found connector entry paths
 */
export async function scanConnectorDirectory(dirPath: string): Promise<string[]> {
  const candidates = ['index.js', 'connector.js', 'index.mjs', 'connector.mjs'];
  const found: string[] = [];

  for (const candidate of candidates) {
    const candidatePath = path.join(dirPath, candidate);
    try {
      await fs.access(candidatePath);
      found.push(candidatePath);
    } catch {
      // File doesn't exist, skip
    }
  }

  return found;
}
