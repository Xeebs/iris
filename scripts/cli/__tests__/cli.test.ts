/**
 * CLI unit tests — argument parsing and command routing via dispatch().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatch, USAGE } from '../index.js';

// ─── Mock sub-commands ─────────────────────────────────────────────────────────

vi.mock('../test-connector.js', () => ({
  runConnectorTest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../debug-mcp.js', () => ({
  runMcpDebug: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../inspect-index.js', () => ({
  runIndexInspect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../simulate-sync.js', () => ({
  runSyncSimulate: vi.fn().mockResolvedValue(undefined),
}));

import { runConnectorTest } from '../test-connector.js';
import { runMcpDebug } from '../debug-mcp.js';
import { runIndexInspect } from '../inspect-index.js';
import { runSyncSimulate } from '../simulate-sync.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function spyOnExit(): { exitCode: number | undefined; restore: () => void } {
  let exitCode: number | undefined;
  const spy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw Object.assign(new Error('process.exit'), { isExit: true, code: exitCode });
  }) as (code?: number) => never);
  return {
    get exitCode() { return exitCode; },
    restore: () => spy.mockRestore(),
  };
}

async function run(...args: string[]): Promise<{ exitCode: number | undefined; stdout: string; stderr: string }> {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { stdoutLines.push(a.join(' ')); });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => { stderrLines.push(a.join(' ')); });
  const exitTracker = spyOnExit();

  try {
    await dispatch(args);
  } catch (e) {
    if (!(e instanceof Error && (e as { isExit?: boolean }).isExit)) throw e;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitTracker.restore();
  }

  return {
    exitCode: exitTracker.exitCode,
    stdout: stdoutLines.join('\n'),
    stderr: stderrLines.join('\n'),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('CLI dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('help', () => {
    it('shows usage when no args provided (exit 0)', async () => {
      const { exitCode, stdout } = await run();
      expect(stdout).toContain('Iris Developer CLI');
      expect(exitCode).toBe(0);
    });

    it('shows usage with --help', async () => {
      const { exitCode, stdout } = await run('--help');
      expect(stdout).toContain('COMMANDS');
      expect(exitCode).toBe(0);
    });

    it('shows usage with -h', async () => {
      const { exitCode, stdout } = await run('-h');
      expect(stdout).toContain('connector:test');
      expect(exitCode).toBe(0);
    });

    it('USAGE export contains all commands', () => {
      expect(USAGE).toContain('connector:test');
      expect(USAGE).toContain('mcp:debug');
      expect(USAGE).toContain('index:inspect');
      expect(USAGE).toContain('sync:simulate');
    });
  });

  describe('connector:test', () => {
    it('routes connector:test with name', async () => {
      await run('connector:test', 'hubspot');
      expect(runConnectorTest).toHaveBeenCalledWith('hubspot', false);
    });

    it('passes --watch flag', async () => {
      await run('connector:test', 'salesforce', '--watch');
      expect(runConnectorTest).toHaveBeenCalledWith('salesforce', true);
    });

    it('exits 1 when no name provided', async () => {
      const { exitCode, stderr } = await run('connector:test');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('requires a connector name');
    });
  });

  describe('mcp:debug', () => {
    it('invokes runMcpDebug', async () => {
      await run('mcp:debug');
      expect(runMcpDebug).toHaveBeenCalledTimes(1);
    });
  });

  describe('index:inspect', () => {
    it('routes with query string', async () => {
      await run('index:inspect', 'top customers by ARR');
      expect(runIndexInspect).toHaveBeenCalledWith('top customers by ARR', 10);
    });

    it('passes --top=N option', async () => {
      await run('index:inspect', 'churn risk', '--top=5');
      expect(runIndexInspect).toHaveBeenCalledWith('churn risk', 5);
    });

    it('exits 1 when no query provided', async () => {
      const { exitCode, stderr } = await run('index:inspect');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('requires a search query');
    });
  });

  describe('sync:simulate', () => {
    it('routes with connectorId', async () => {
      await run('sync:simulate', 'hubspot-prod');
      expect(runSyncSimulate).toHaveBeenCalledWith('hubspot-prod');
    });

    it('exits 1 when no connectorId', async () => {
      const { exitCode, stderr } = await run('sync:simulate');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('requires a connectorId');
    });
  });

  describe('unknown command', () => {
    it('exits 1 for unknown command', async () => {
      const { exitCode, stderr } = await run('not:a:command');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown command');
    });

    it('mentions --help in error message', async () => {
      const { stderr } = await run('not:a:command');
      expect(stderr).toContain('--help');
    });
  });
});
