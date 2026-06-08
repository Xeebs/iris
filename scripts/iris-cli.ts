#!/usr/bin/env tsx
/**
 * Iris Administration CLI
 *
 * A production-ready CLI for Iris operators and developers.
 * Auth: IRIS_API_KEY env var (required for all commands)
 * API base: IRIS_API_URL env var (default: http://localhost:3001)
 *
 * Usage:
 *   iris-cli connector list [--workspace=<id>]
 *   iris-cli connector describe <connectorId>
 *   iris-cli connector sync <connectorId> [--dry-run]
 *   iris-cli connector health <connectorId>
 *   iris-cli workspace list
 *   iris-cli workspace create <name>
 *   iris-cli backup create [--workspace=<id>]
 *   iris-cli backup list [--workspace=<id>]
 *   iris-cli backup restore <backupId> --to=<iso-timestamp>
 *   iris-cli admin set-quota <workspaceId> <tier>
 *   iris-cli admin reset-rate-limit <workspaceId>
 *   iris-cli admin audit-export <workspaceId> [--output=json|csv]
 *   iris-cli diagnostics check-services
 *   iris-cli diagnostics analyze-token-usage [--workspace=<id>]
 */

export type OutputFormat = 'json' | 'table' | 'csv';

export type CliContext = {
  apiKey: string;
  apiUrl: string;
  workspace: string | null;
  output: OutputFormat;
  dryRun: boolean;
};

// ─── Argument parsing helpers ─────────────────────────────────────────────────

/**
 * Parse --flag=value and --flag style args into a structured object.
 * @param args - Raw argv slice (no node/script prefix)
 * @returns Parsed positionals and flags
 */
export function parseArgs(args: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)!] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

/**
 * Format a list of records as a simple ASCII table.
 * @param records - Array of objects with string/number values
 * @returns Formatted table string
 */
export function formatTable(records: Record<string, unknown>[]): string {
  if (records.length === 0) return '(no results)';
  const keys = Object.keys(records[0]!);
  const colWidths = keys.map((k) => Math.max(k.length, ...records.map((r) => String(r[k] ?? '').length)));
  const separator = colWidths.map((w) => '-'.repeat(w)).join('  ');
  const header = keys.map((k, i) => k.padEnd(colWidths[i]!)).join('  ');
  const rows = records.map((r) => keys.map((k, i) => String(r[k] ?? '').padEnd(colWidths[i]!)).join('  '));
  return [header, separator, ...rows].join('\n');
}

/**
 * Format records as CSV.
 * @param records - Array of objects
 * @returns CSV string with header row
 */
export function formatCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return '';
  const keys = Object.keys(records[0]!);
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...records.map((r) => keys.map((k) => escape(r[k])).join(','))].join('\n');
}

/**
 * Render records according to the requested output format.
 * @param records - Array of objects
 * @param format - Output format
 */
export function renderOutput(records: Record<string, unknown>[], format: OutputFormat): string {
  switch (format) {
    case 'json': return JSON.stringify(records, null, 2);
    case 'csv': return formatCsv(records);
    case 'table': return formatTable(records);
  }
}

// ─── API client ───────────────────────────────────────────────────────────────

/**
 * Make an authenticated API call to the Iris REST API.
 * @param ctx - CLI context with credentials and URL
 * @param method - HTTP method
 * @param path - API path (e.g. "/api/v1/connectors")
 * @param body - Optional request body (JSON-serialized)
 */
export async function apiCall<T = unknown>(
  ctx: CliContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${ctx.apiUrl}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${ctx.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (ctx.workspace) headers['X-Workspace-Id'] = ctx.workspace;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export type CommandResult = { records: Record<string, unknown>[]; message?: string };

/**
 * Handle connector sub-commands.
 */
export async function connectorCommand(
  sub: string,
  positionals: string[],
  flags: Record<string, string | boolean>,
  ctx: CliContext,
): Promise<CommandResult> {
  switch (sub) {
    case 'list': {
      const data = await apiCall<{ data: Record<string, unknown>[] }>(ctx, 'GET', '/api/v1/connectors');
      return { records: data.data ?? [] };
    }
    case 'describe': {
      const id = positionals[0];
      if (!id) throw new Error('connector describe requires a connectorId');
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'GET', `/api/v1/connectors/${id}`);
      return { records: [data.data] };
    }
    case 'sync': {
      const id = positionals[0];
      if (!id) throw new Error('connector sync requires a connectorId');
      if (flags['dry-run']) return { records: [], message: `[dry-run] Would trigger sync for connector ${id}` };
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'POST', `/api/v1/connectors/${id}/sync`);
      return { records: [data.data] };
    }
    case 'health': {
      const id = positionals[0];
      if (!id) throw new Error('connector health requires a connectorId');
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'POST', `/api/v1/connectors/${id}/test`);
      return { records: [data.data] };
    }
    default:
      throw new Error(`Unknown connector sub-command: ${sub}. Valid: list, describe, sync, health`);
  }
}

/**
 * Handle workspace sub-commands.
 */
export async function workspaceCommand(
  sub: string,
  positionals: string[],
  flags: Record<string, string | boolean>,
  ctx: CliContext,
): Promise<CommandResult> {
  switch (sub) {
    case 'list': {
      const data = await apiCall<{ data: Record<string, unknown>[] }>(ctx, 'GET', '/api/v1/workspaces');
      return { records: data.data ?? [] };
    }
    case 'create': {
      const name = positionals[0];
      if (!name) throw new Error('workspace create requires a name');
      if (flags['dry-run']) return { records: [], message: `[dry-run] Would create workspace "${name}"` };
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'POST', '/api/v1/workspaces', { name });
      return { records: [data.data] };
    }
    default:
      throw new Error(`Unknown workspace sub-command: ${sub}. Valid: list, create`);
  }
}

/**
 * Handle backup sub-commands.
 */
export async function backupCommand(
  sub: string,
  positionals: string[],
  flags: Record<string, string | boolean>,
  ctx: CliContext,
): Promise<CommandResult> {
  switch (sub) {
    case 'list': {
      const data = await apiCall<{ data: Record<string, unknown>[] }>(ctx, 'GET', '/api/v1/backup-recovery');
      return { records: data.data ?? [] };
    }
    case 'create': {
      if (flags['dry-run']) return { records: [], message: '[dry-run] Would create full backup' };
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'POST', '/api/v1/backup-recovery/full');
      return { records: [data.data] };
    }
    case 'restore': {
      const backupId = positionals[0];
      const to = flags['to'];
      if (!backupId) throw new Error('backup restore requires a backupId');
      if (!to || typeof to !== 'string') throw new Error('backup restore requires --to=<iso-timestamp>');
      if (flags['dry-run']) return { records: [], message: `[dry-run] Would restore backup ${backupId} to ${to}` };
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'POST', `/api/v1/backup-recovery/${backupId}/restore-to-point`, { targetTimestamp: to });
      return { records: [data.data] };
    }
    case 'verify': {
      const backupId = positionals[0];
      if (!backupId) throw new Error('backup verify requires a backupId');
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'POST', `/api/v1/backup-recovery/${backupId}/validate`);
      return { records: [data.data] };
    }
    default:
      throw new Error(`Unknown backup sub-command: ${sub}. Valid: list, create, restore, verify`);
  }
}

/**
 * Handle admin sub-commands.
 */
export async function adminCommand(
  sub: string,
  positionals: string[],
  flags: Record<string, string | boolean>,
  ctx: CliContext,
): Promise<CommandResult> {
  switch (sub) {
    case 'set-quota': {
      const [workspaceId, tier] = positionals;
      if (!workspaceId || !tier) throw new Error('admin set-quota requires <workspaceId> <tier>');
      if (!['free', 'pro', 'enterprise'].includes(tier)) throw new Error(`Invalid tier: ${tier}. Valid: free, pro, enterprise`);
      if (flags['dry-run']) return { records: [], message: `[dry-run] Would set workspace ${workspaceId} to tier ${tier}` };
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'PUT', `/api/v1/quota-management/admin/rate-limits/${workspaceId}`, { tier });
      return { records: [data.data] };
    }
    case 'reset-rate-limit': {
      const workspaceId = positionals[0];
      if (!workspaceId) throw new Error('admin reset-rate-limit requires <workspaceId>');
      if (flags['dry-run']) return { records: [], message: `[dry-run] Would reset rate limit for workspace ${workspaceId}` };
      const data = await apiCall<{ data: Record<string, unknown> }>(ctx, 'DELETE', `/api/v1/quota-management/admin/rate-limits/${workspaceId}/buckets`);
      return { records: data.data ? [data.data] : [], message: `Rate limit buckets cleared for ${workspaceId}` };
    }
    case 'audit-export': {
      const workspaceId = positionals[0];
      if (!workspaceId) throw new Error('admin audit-export requires <workspaceId>');
      const data = await apiCall<{ data: Record<string, unknown>[] }>(ctx, 'GET', `/api/v1/permissions/roles/${workspaceId}/audit`);
      return { records: data.data ?? [] };
    }
    default:
      throw new Error(`Unknown admin sub-command: ${sub}. Valid: set-quota, reset-rate-limit, audit-export`);
  }
}

/**
 * Handle diagnostics sub-commands.
 */
export async function diagnosticsCommand(
  sub: string,
  _positionals: string[],
  _flags: Record<string, string | boolean>,
  ctx: CliContext,
): Promise<CommandResult> {
  switch (sub) {
    case 'check-services': {
      const [apiHealth, mcpHealth] = await Promise.allSettled([
        apiCall<{ status: string }>(ctx, 'GET', '/health'),
        apiCall<{ status: string }>(ctx, 'GET', '/mcp/health').catch(() => ({ status: 'unreachable' })),
      ]);
      return {
        records: [
          { service: 'api', status: apiHealth.status === 'fulfilled' ? (apiHealth.value as { status?: string }).status ?? 'ok' : 'unreachable' },
          { service: 'mcp', status: mcpHealth.status === 'fulfilled' ? (mcpHealth.value as { status?: string }).status ?? 'ok' : 'unreachable' },
        ],
      };
    }
    case 'analyze-token-usage': {
      const data = await apiCall<{ data: Record<string, unknown>[] }>(ctx, 'GET', '/api/v1/analytics/metrics/tokens_used?window=1d');
      return { records: data.data ?? [] };
    }
    default:
      throw new Error(`Unknown diagnostics sub-command: ${sub}. Valid: check-services, analyze-token-usage`);
  }
}

// ─── Top-level dispatcher ─────────────────────────────────────────────────────

export const USAGE = `
Iris Administration CLI

USAGE
  iris-cli <command> <sub-command> [args] [options]

COMMANDS
  connector list|describe|sync|health
  workspace list|create
  backup    list|create|restore|verify
  admin     set-quota|reset-rate-limit|audit-export
  diagnostics check-services|analyze-token-usage

GLOBAL OPTIONS
  --workspace=<id>   Workspace ID (or set IRIS_WORKSPACE)
  --output=<format>  Output format: json|table|csv (default: table)
  --dry-run          Preview action without making changes
  --help, -h         Show help

ENVIRONMENT
  IRIS_API_KEY   Required. API key for authentication.
  IRIS_API_URL   API base URL (default: http://localhost:3001)
  IRIS_WORKSPACE Default workspace ID

EXAMPLES
  iris-cli connector list
  iris-cli connector sync hubspot-prod --dry-run
  iris-cli backup create --workspace=ws-123
  iris-cli admin set-quota ws-123 pro
  iris-cli diagnostics check-services --output=json
`.trim();

/**
 * Dispatch a parsed argv slice to the appropriate command handler.
 * Exported for testability.
 *
 * @param args - Command and flags array (no 'node' / script name prefix)
 * @param env - Environment variables (defaults to process.env)
 * @param printer - Output function (defaults to console.log)
 */
export async function dispatch(
  args: string[],
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  printer: (s: string) => void = console.log,
): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printer(USAGE);
    return;
  }

  const { positionals, flags } = parseArgs(args);
  const [command, sub, ...rest] = positionals;

  if (!command) {
    printer(USAGE);
    return;
  }

  const apiKey = env['IRIS_API_KEY'] ?? '';
  if (!apiKey) throw new Error('IRIS_API_KEY environment variable is required');

  const ctx: CliContext = {
    apiKey,
    apiUrl: env['IRIS_API_URL'] ?? 'http://localhost:3001',
    workspace: (flags['workspace'] as string) ?? env['IRIS_WORKSPACE'] ?? null,
    output: ((flags['output'] as string) ?? 'table') as OutputFormat,
    dryRun: flags['dry-run'] === true,
  };

  let result: CommandResult;

  const subPositionals = rest;
  const subFlags = { ...flags };

  switch (command) {
    case 'connector':
      if (!sub) throw new Error('connector requires a sub-command. Run --help for usage.');
      result = await connectorCommand(sub, subPositionals, subFlags, ctx);
      break;
    case 'workspace':
      if (!sub) throw new Error('workspace requires a sub-command. Run --help for usage.');
      result = await workspaceCommand(sub, subPositionals, subFlags, ctx);
      break;
    case 'backup':
      if (!sub) throw new Error('backup requires a sub-command. Run --help for usage.');
      result = await backupCommand(sub, subPositionals, subFlags, ctx);
      break;
    case 'admin':
      if (!sub) throw new Error('admin requires a sub-command. Run --help for usage.');
      result = await adminCommand(sub, subPositionals, subFlags, ctx);
      break;
    case 'diagnostics':
      if (!sub) throw new Error('diagnostics requires a sub-command. Run --help for usage.');
      result = await diagnosticsCommand(sub, subPositionals, subFlags, ctx);
      break;
    default:
      throw new Error(`Unknown command: ${command}. Run --help for usage.`);
  }

  if (result.message) printer(result.message);
  if (result.records.length > 0) printer(renderOutput(result.records, ctx.output));
}

// Entry point
if (process.argv[1] && process.argv[1].endsWith('iris-cli.ts')) {
  dispatch(process.argv.slice(2)).catch((e: unknown) => {
    console.error('Error:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
