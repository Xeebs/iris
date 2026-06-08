import { ok, err, type Result } from 'neverthrow';
import { z } from 'zod';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ service: 'mcp-tool-versioning' });

export type ToolVersion = {
  toolName: string;
  version: string;
  schemaJson: Record<string, unknown>;
  handlerRef: string;
  isActive: boolean;
  createdAt: Date;
};

export type ToolDeprecation = {
  toolName: string;
  version: string;
  sunsetDate: Date;
  message: string;
  createdAt: Date;
};

export type VersionResolution = {
  toolName: string;
  resolvedVersion: string;
  isDeprecated: boolean;
  sunsetDate: Date | null;
  deprecationMessage: string | null;
};

export type ClientSdkStub = {
  toolName: string;
  version: string;
  language: 'typescript' | 'python';
  code: string;
};

const semverSchema = z.string().regex(/^\d+\.\d+$/, 'Version must be MAJOR.MINOR (e.g. "1.0", "2.3")');

/**
 * Parse semantic version string "MAJOR.MINOR" into comparable numeric form.
 * @param version - Version string like "1.0" or "2.3"
 * @returns Numeric value for comparison
 */
function versionToNumber(version: string): number {
  const parts = version.split('.');
  const major = parseInt(parts[0] ?? '0', 10);
  const minor = parseInt(parts[1] ?? '0', 10);
  return major * 1000 + minor;
}

/**
 * Determine if clientVersion is compatible with a registered toolVersion.
 * Client 1.x can use tool 1.x, client 2.x requires tool 2.x+.
 * @param clientVersion - Version the client declares (or requested)
 * @param toolVersion - Version of the registered handler
 */
function isCompatible(clientVersion: string, toolVersion: string): boolean {
  const [clientMajor] = clientVersion.split('.');
  const [toolMajor] = toolVersion.split('.');
  return clientMajor === toolMajor && versionToNumber(toolVersion) <= versionToNumber(clientVersion);
}

/**
 * Manages MCP tool versioning, handler resolution, and deprecation lifecycle.
 */
export class ToolVersionManager {
  private readonly sql: SqlFn;

  constructor(sql: SqlFn) {
    this.sql = sql;
  }

  /**
   * Register a new version of an MCP tool with its input schema and handler reference.
   * @param toolName - MCP tool name (e.g. "query-context")
   * @param version - Semantic version "MAJOR.MINOR"
   * @param schemaJson - Zod-serializable JSON schema for tool inputs
   * @param handlerRef - Qualified handler reference (e.g. "tools/query-context.v2")
   * @returns The registered ToolVersion record
   */
  async registerToolVersion(
    toolName: string,
    version: string,
    schemaJson: Record<string, unknown>,
    handlerRef: string,
  ): Promise<Result<ToolVersion, Error>> {
    const versionParse = semverSchema.safeParse(version);
    if (!versionParse.success) {
      return err(new Error(versionParse.error.issues[0]?.message ?? 'Invalid version'));
    }
    try {
      const rows = await this.sql`
        INSERT INTO mcp_tool_versions (tool_name, version, schema_json, handler_ref, is_active)
        VALUES (${toolName}, ${version}, ${JSON.stringify(schemaJson)}, ${handlerRef}, true)
        ON CONFLICT (tool_name, version)
        DO UPDATE SET schema_json = EXCLUDED.schema_json, handler_ref = EXCLUDED.handler_ref, is_active = true
        RETURNING tool_name, version, schema_json, handler_ref, is_active, created_at
      ` as unknown as Array<{
        tool_name: string;
        version: string;
        schema_json: string;
        handler_ref: string;
        is_active: boolean;
        created_at: Date;
      }>;
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));
      const record: ToolVersion = {
        toolName: row.tool_name,
        version: row.version,
        schemaJson: JSON.parse(row.schema_json) as Record<string, unknown>,
        handlerRef: row.handler_ref,
        isActive: row.is_active,
        createdAt: row.created_at,
      };
      log.info('Tool version registered', { toolName, version, handlerRef });
      return ok(record);
    } catch (e) {
      log.error('Failed to register tool version', { toolName, version, error: e instanceof Error ? e.message : e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Resolve the best matching handler version for a given client version request.
   * Prefers the highest compatible version. Falls back to latest if no exact match.
   * @param toolName - MCP tool name
   * @param clientVersion - Client's declared version (e.g. "1.0")
   * @returns Resolution with selected version and deprecation info
   */
  async resolveHandler(
    toolName: string,
    clientVersion: string,
  ): Promise<Result<VersionResolution, Error>> {
    try {
      const rows = await this.sql`
        SELECT v.tool_name, v.version, d.sunset_date, d.message AS deprecation_message
        FROM mcp_tool_versions v
        LEFT JOIN mcp_tool_deprecations d ON d.tool_name = v.tool_name AND d.version = v.version
        WHERE v.tool_name = ${toolName} AND v.is_active = true
        ORDER BY v.version DESC
      ` as unknown as Array<{
        tool_name: string;
        version: string;
        sunset_date: Date | null;
        deprecation_message: string | null;
      }>;

      if (rows.length === 0) {
        return err(new Error(`No active versions found for tool '${toolName}'`));
      }

      const compatible = rows.filter(r => isCompatible(clientVersion, r.version));
      const selected = compatible[0] ?? rows[0];
      if (!selected) return err(new Error('No matching handler'));

      return ok({
        toolName: selected.tool_name,
        resolvedVersion: selected.version,
        isDeprecated: selected.sunset_date !== null,
        sunsetDate: selected.sunset_date,
        deprecationMessage: selected.deprecation_message,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generate a client SDK stub for a specific tool version.
   * @param toolName - MCP tool name
   * @param language - Target language: "typescript" or "python"
   * @param version - Tool version (optional; uses latest if omitted)
   * @returns SDK stub with generated code
   */
  async generateClientSdkStub(
    toolName: string,
    language: 'typescript' | 'python',
    version?: string,
  ): Promise<Result<ClientSdkStub, Error>> {
    try {
      const rows = version
        ? await this.sql`
            SELECT tool_name, version, schema_json
            FROM mcp_tool_versions
            WHERE tool_name = ${toolName} AND is_active = true AND version = ${version}
          ` as unknown as Array<{ tool_name: string; version: string; schema_json: string }>
        : await this.sql`
            SELECT tool_name, version, schema_json
            FROM mcp_tool_versions
            WHERE tool_name = ${toolName} AND is_active = true
            ORDER BY version DESC LIMIT 1
          ` as unknown as Array<{ tool_name: string; version: string; schema_json: string }>;

      const row = rows[0];
      if (!row) return err(new Error(`Tool '${toolName}' version '${version ?? 'latest'}' not found`));

      const schema = JSON.parse(row.schema_json) as Record<string, unknown>;
      const code = language === 'typescript'
        ? generateTypeScriptStub(row.tool_name, row.version, schema)
        : generatePythonStub(row.tool_name, row.version, schema);

      return ok({ toolName: row.tool_name, version: row.version, language, code });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Mark a tool version as deprecated with a sunset date.
   * @param toolName - MCP tool name
   * @param version - Version to deprecate
   * @param sunsetDate - Date after which the version will be removed
   * @param message - Human-readable deprecation notice
   */
  async deprecateVersion(
    toolName: string,
    version: string,
    sunsetDate: Date,
    message: string,
  ): Promise<Result<ToolDeprecation, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO mcp_tool_deprecations (tool_name, version, sunset_date, message)
        VALUES (${toolName}, ${version}, ${sunsetDate}, ${message})
        ON CONFLICT (tool_name, version)
        DO UPDATE SET sunset_date = EXCLUDED.sunset_date, message = EXCLUDED.message
        RETURNING tool_name, version, sunset_date, message, created_at
      ` as unknown as Array<{
        tool_name: string;
        version: string;
        sunset_date: Date;
        message: string;
        created_at: Date;
      }>;
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));
      log.warn('Tool version deprecated', { toolName, version, sunsetDate });
      return ok({
        toolName: row.tool_name,
        version: row.version,
        sunsetDate: row.sunset_date,
        message: row.message,
        createdAt: row.created_at,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all registered versions for a tool, including deprecation status.
   * @param toolName - MCP tool name
   */
  async listVersions(toolName: string): Promise<Result<(ToolVersion & { sunsetDate: Date | null; deprecationMessage: string | null })[], Error>> {
    try {
      const rows = await this.sql`
        SELECT v.tool_name, v.version, v.schema_json, v.handler_ref, v.is_active, v.created_at,
               d.sunset_date, d.message AS deprecation_message
        FROM mcp_tool_versions v
        LEFT JOIN mcp_tool_deprecations d ON d.tool_name = v.tool_name AND d.version = v.version
        WHERE v.tool_name = ${toolName}
        ORDER BY v.version DESC
      ` as unknown as Array<{
        tool_name: string;
        version: string;
        schema_json: string;
        handler_ref: string;
        is_active: boolean;
        created_at: Date;
        sunset_date: Date | null;
        deprecation_message: string | null;
      }>;
      return ok(rows.map(r => ({
        toolName: r.tool_name,
        version: r.version,
        schemaJson: JSON.parse(r.schema_json) as Record<string, unknown>,
        handlerRef: r.handler_ref,
        isActive: r.is_active,
        createdAt: r.created_at,
        sunsetDate: r.sunset_date,
        deprecationMessage: r.deprecation_message,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all tools with their latest active version.
   */
  async listAllTools(): Promise<Result<{ toolName: string; latestVersion: string; totalVersions: number }[], Error>> {
    try {
      const rows = await this.sql`
        SELECT tool_name,
               MAX(version) AS latest_version,
               COUNT(*) AS total_versions
        FROM mcp_tool_versions
        WHERE is_active = true
        GROUP BY tool_name
        ORDER BY tool_name
      ` as unknown as Array<{ tool_name: string; latest_version: string; total_versions: string }>;
      return ok(rows.map(r => ({
        toolName: r.tool_name,
        latestVersion: r.latest_version,
        totalVersions: parseInt(r.total_versions, 10),
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Deactivate a tool version without deleting it (soft delete).
   * @param toolName - MCP tool name
   * @param version - Version to deactivate
   */
  async deactivateVersion(toolName: string, version: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE mcp_tool_versions SET is_active = false
        WHERE tool_name = ${toolName} AND version = ${version}
      `;
      log.info('Tool version deactivated', { toolName, version });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

function toPascalCase(s: string): string {
  return s.replace(/(^|-|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());
}

function generateTypeScriptStub(toolName: string, version: string, schema: Record<string, unknown>): string {
  const typeName = toPascalCase(toolName) + 'Input';
  const fnName = toolName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const properties = (schema['properties'] as Record<string, { type?: string; description?: string }> | undefined) ?? {};
  const required = (schema['required'] as string[] | undefined) ?? [];

  const fields = Object.entries(properties)
    .map(([k, v]) => {
      const tsType = v.type === 'integer' || v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string';
      const opt = required.includes(k) ? '' : '?';
      return `  ${k}${opt}: ${tsType};`;
    })
    .join('\n');

  return `// Auto-generated SDK stub for ${toolName} v${version}
// Do not edit manually — regenerate with the Iris admin console

export type ${typeName} = {
${fields}
};

export async function ${fnName}(input: ${typeName}): Promise<string> {
  const res = await fetch('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tool-Version': '${version}' },
    body: JSON.stringify({ tool: '${toolName}', input }),
  });
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}
`;
}

function generatePythonStub(toolName: string, version: string, schema: Record<string, unknown>): string {
  const fnName = toolName.replace(/-/g, '_');
  const properties = (schema['properties'] as Record<string, { type?: string }> | undefined) ?? {};
  const required = (schema['required'] as string[] | undefined) ?? [];

  const params = Object.entries(properties).map(([k, v]) => {
    const pyType = v.type === 'integer' ? 'int' : v.type === 'number' ? 'float' : v.type === 'boolean' ? 'bool' : 'str';
    const opt = required.includes(k) ? '' : ' = None';
    return `    ${k}: ${pyType}${opt}`;
  }).join(',\n');

  return `# Auto-generated SDK stub for ${toolName} v${version}
# Do not edit manually — regenerate with the Iris admin console

import httpx
from typing import Optional


def ${fnName}(
${params}
) -> str:
    response = httpx.post(
        "/mcp",
        json={"tool": "${toolName}", "input": {k: v for k, v in locals().items() if v is not None}},
        headers={"X-Tool-Version": "${version}"},
    )
    response.raise_for_status()
    data = response.json()
    return data.get("content", [{}])[0].get("text", "")
`;
}
