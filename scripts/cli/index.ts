#!/usr/bin/env tsx
/**
 * Iris developer CLI — local testing and debugging utilities.
 *
 * Usage:
 *   iris-cli connector:test <name> [--watch]
 *   iris-cli mcp:debug
 *   iris-cli index:inspect <query> [--top=N]
 *   iris-cli sync:simulate <connectorId>
 */

import { runConnectorTest } from './test-connector.js';
import { runMcpDebug } from './debug-mcp.js';
import { runIndexInspect } from './inspect-index.js';
import { runSyncSimulate } from './simulate-sync.js';

export const USAGE = `
Iris Developer CLI

USAGE
  iris-cli <command> [options]

COMMANDS
  connector:test <name> [--watch]   Run connector tests with optional live reload
  mcp:debug                         Start MCP server in debug mode (verbose logging)
  index:inspect <query> [--top=N]   Query the local vector index and show similarity scores
  sync:simulate <connectorId>       Dry-run a sync without persisting, show token estimates

OPTIONS
  --help, -h     Show this help message

EXAMPLES
  iris-cli connector:test hubspot
  iris-cli connector:test hubspot --watch
  iris-cli mcp:debug
  iris-cli index:inspect "top customers by ARR"
  iris-cli index:inspect "churn risk" --top=5
  iris-cli sync:simulate hubspot-prod
`.trim();

/**
 * Dispatch a parsed argv array to the appropriate CLI command.
 * Exported for testability — call with raw args (no 'node' / script name prefix).
 *
 * @param args - Command and flags array (e.g. ['connector:test', 'hubspot', '--watch'])
 */
export async function dispatch(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const command = args[0]!;

  switch (command) {
    case 'connector:test': {
      const name = args[1];
      if (!name || name.startsWith('--')) {
        console.error('Error: connector:test requires a connector name\n  Usage: iris-cli connector:test <name> [--watch]');
        process.exit(1);
      }
      const watch = args.includes('--watch');
      await runConnectorTest(name, watch);
      break;
    }

    case 'mcp:debug':
      await runMcpDebug();
      break;

    case 'index:inspect': {
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      if (!query) {
        console.error('Error: index:inspect requires a search query\n  Usage: iris-cli index:inspect "<query text>"');
        process.exit(1);
      }
      const topArg = args.find(a => a.startsWith('--top='))?.split('=')[1];
      const topK = topArg ? Number(topArg) : 10;
      await runIndexInspect(query, topK);
      break;
    }

    case 'sync:simulate': {
      const connectorId = args[1];
      if (!connectorId || connectorId.startsWith('--')) {
        console.error('Error: sync:simulate requires a connectorId\n  Usage: iris-cli sync:simulate <connectorId>');
        process.exit(1);
      }
      await runSyncSimulate(connectorId);
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n\nRun "iris-cli --help" for usage.`);
      process.exit(1);
  }
}

// Entry point — only executes when run directly (not during import in tests)
if (process.argv[1] && (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('iris-cli'))) {
  dispatch(process.argv.slice(2)).catch(e => {
    console.error('Fatal error:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
