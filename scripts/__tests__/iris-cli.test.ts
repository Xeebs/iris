import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseArgs,
  formatTable,
  formatCsv,
  renderOutput,
  dispatch,
  connectorCommand,
  workspaceCommand,
  backupCommand,
  adminCommand,
  diagnosticsCommand,
  USAGE,
} from '../iris-cli.js';

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('splits positionals and flags', () => {
    const { positionals, flags } = parseArgs(['connector', 'list', '--workspace=ws-1', '--dry-run']);
    expect(positionals).toEqual(['connector', 'list']);
    expect(flags['workspace']).toBe('ws-1');
    expect(flags['dry-run']).toBe(true);
  });

  it('handles --flag=value with = in value', () => {
    const { flags } = parseArgs(['--to=2026-01-01T00:00:00Z']);
    expect(flags['to']).toBe('2026-01-01T00:00:00Z');
  });

  it('returns empty arrays for no input', () => {
    const { positionals, flags } = parseArgs([]);
    expect(positionals).toEqual([]);
    expect(flags).toEqual({});
  });

  it('handles boolean flag (no value)', () => {
    const { flags } = parseArgs(['--verbose']);
    expect(flags['verbose']).toBe(true);
  });
});

// ─── formatTable ─────────────────────────────────────────────────────────────

describe('formatTable', () => {
  it('renders a simple table', () => {
    const output = formatTable([{ id: 'c1', name: 'HubSpot', status: 'active' }]);
    expect(output).toContain('id');
    expect(output).toContain('c1');
    expect(output).toContain('HubSpot');
  });

  it('returns no results for empty array', () => {
    expect(formatTable([])).toBe('(no results)');
  });

  it('pads columns to equal width', () => {
    const output = formatTable([
      { x: 'short', y: 'hello' },
      { x: 'a much longer value', y: 'world' },
    ]);
    const lines = output.split('\n');
    // All lines should have the same length (padded)
    const lengths = new Set(lines.map((l) => l.length));
    expect(lengths.size).toBe(1);
  });
});

// ─── formatCsv ───────────────────────────────────────────────────────────────

describe('formatCsv', () => {
  it('renders CSV with header', () => {
    const output = formatCsv([{ id: 'ws-1', name: 'Acme' }]);
    expect(output.split('\n')[0]).toBe('id,name');
    expect(output.split('\n')[1]).toBe('ws-1,Acme');
  });

  it('escapes commas in values', () => {
    const output = formatCsv([{ name: 'Acme, Corp' }]);
    expect(output).toContain('"Acme, Corp"');
  });

  it('escapes double quotes', () => {
    const output = formatCsv([{ name: 'Say "hello"' }]);
    expect(output).toContain('"Say ""hello"""');
  });

  it('returns empty string for empty array', () => {
    expect(formatCsv([])).toBe('');
  });
});

// ─── renderOutput ─────────────────────────────────────────────────────────────

describe('renderOutput', () => {
  const records = [{ id: '1', name: 'Test' }];

  it('renders json', () => {
    const out = renderOutput(records, 'json');
    expect(JSON.parse(out)).toEqual(records);
  });

  it('renders table', () => {
    expect(renderOutput(records, 'table')).toContain('Test');
  });

  it('renders csv', () => {
    const out = renderOutput(records, 'csv');
    expect(out).toContain('id,name');
  });
});

// ─── dispatch ─────────────────────────────────────────────────────────────────

describe('dispatch — help and routing', () => {
  it('prints usage for --help', async () => {
    const print = vi.fn();
    await dispatch(['--help'], { IRIS_API_KEY: 'k' }, print);
    expect(print).toHaveBeenCalledWith(expect.stringContaining('iris-cli'));
  });

  it('prints usage for empty args', async () => {
    const print = vi.fn();
    await dispatch([], { IRIS_API_KEY: 'k' }, print);
    expect(print).toHaveBeenCalledWith(expect.stringContaining('COMMANDS'));
  });

  it('throws when IRIS_API_KEY is missing', async () => {
    await expect(dispatch(['connector', 'list'], {})).rejects.toThrow('IRIS_API_KEY');
  });

  it('throws for unknown command', async () => {
    await expect(dispatch(['foobar', 'sub'], { IRIS_API_KEY: 'k' })).rejects.toThrow('Unknown command');
  });

  it('throws when sub-command is missing', async () => {
    await expect(dispatch(['connector'], { IRIS_API_KEY: 'k' })).rejects.toThrow('sub-command');
  });
});

// ─── connectorCommand ─────────────────────────────────────────────────────────

describe('connectorCommand', () => {
  const ctx = { apiKey: 'k', apiUrl: 'http://localhost:3001', workspace: null, output: 'table' as const, dryRun: false };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'c1', name: 'HubSpot' }] }),
    } as Response);
  });

  it('list returns connector records', async () => {
    const result = await connectorCommand('list', [], {}, ctx);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!['name']).toBe('HubSpot');
  });

  it('describe throws without id', async () => {
    await expect(connectorCommand('describe', [], {}, ctx)).rejects.toThrow('connectorId');
  });

  it('sync dry-run returns message without calling API', async () => {
    const result = await connectorCommand('sync', ['hubspot'], { 'dry-run': true }, { ...ctx, dryRun: true });
    expect(result.message).toContain('dry-run');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws for unknown sub-command', async () => {
    await expect(connectorCommand('unknown', [], {}, ctx)).rejects.toThrow('Unknown connector');
  });
});

// ─── workspaceCommand ─────────────────────────────────────────────────────────

describe('workspaceCommand', () => {
  const ctx = { apiKey: 'k', apiUrl: 'http://localhost:3001', workspace: null, output: 'table' as const, dryRun: false };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'ws-1', name: 'Acme' }] }),
    } as Response);
  });

  it('list returns workspaces', async () => {
    const result = await workspaceCommand('list', [], {}, ctx);
    expect(result.records).toHaveLength(1);
  });

  it('create dry-run returns message', async () => {
    const result = await workspaceCommand('create', ['Acme'], { 'dry-run': true }, ctx);
    expect(result.message).toContain('dry-run');
  });

  it('create throws without name', async () => {
    await expect(workspaceCommand('create', [], {}, ctx)).rejects.toThrow('name');
  });
});

// ─── backupCommand ────────────────────────────────────────────────────────────

describe('backupCommand', () => {
  const ctx = { apiKey: 'k', apiUrl: 'http://localhost:3001', workspace: null, output: 'table' as const, dryRun: false };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: 'bk-1', status: 'completed' } }),
    } as Response);
  });

  it('create dry-run returns message', async () => {
    const result = await backupCommand('create', [], { 'dry-run': true }, ctx);
    expect(result.message).toContain('dry-run');
  });

  it('restore requires backupId', async () => {
    await expect(backupCommand('restore', [], { to: '2026-01-01T00:00:00Z' }, ctx)).rejects.toThrow('backupId');
  });

  it('restore requires --to flag', async () => {
    await expect(backupCommand('restore', ['bk-1'], {}, ctx)).rejects.toThrow('--to');
  });

  it('restore dry-run returns message', async () => {
    const result = await backupCommand('restore', ['bk-1'], { to: '2026-01-01T00:00:00Z', 'dry-run': true }, ctx);
    expect(result.message).toContain('dry-run');
  });
});

// ─── adminCommand ─────────────────────────────────────────────────────────────

describe('adminCommand', () => {
  const ctx = { apiKey: 'k', apiUrl: 'http://localhost:3001', workspace: null, output: 'table' as const, dryRun: false };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { tier: 'pro' } }),
    } as Response);
  });

  it('set-quota dry-run returns message', async () => {
    const result = await adminCommand('set-quota', ['ws-1', 'pro'], { 'dry-run': true }, ctx);
    expect(result.message).toContain('dry-run');
  });

  it('set-quota throws on invalid tier', async () => {
    await expect(adminCommand('set-quota', ['ws-1', 'ultramax'], {}, ctx)).rejects.toThrow('Invalid tier');
  });

  it('set-quota requires workspaceId and tier', async () => {
    await expect(adminCommand('set-quota', ['ws-1'], {}, ctx)).rejects.toThrow('requires');
  });

  it('audit-export requires workspaceId', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);
    const result = await adminCommand('audit-export', ['ws-1'], {}, ctx);
    expect(Array.isArray(result.records)).toBe(true);
  });
});

// ─── diagnosticsCommand ───────────────────────────────────────────────────────

describe('diagnosticsCommand', () => {
  const ctx = { apiKey: 'k', apiUrl: 'http://localhost:3001', workspace: null, output: 'table' as const, dryRun: false };

  it('check-services returns service statuses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    } as Response);
    const result = await diagnosticsCommand('check-services', [], {}, ctx);
    expect(result.records.some((r) => r['service'] === 'api')).toBe(true);
    expect(result.records.some((r) => r['service'] === 'mcp')).toBe(true);
  });

  it('check-services marks unreachable when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    const result = await diagnosticsCommand('check-services', [], {}, ctx);
    expect(result.records.some((r) => r['status'] === 'unreachable')).toBe(true);
  });

  it('throws for unknown sub-command', async () => {
    await expect(diagnosticsCommand('unknown', [], {}, ctx)).rejects.toThrow('Unknown diagnostics');
  });
});
