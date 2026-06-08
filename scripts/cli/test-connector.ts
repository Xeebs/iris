import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const IRIS_ROOT = resolve(import.meta.dirname, '../..');

/**
 * Run connector tests with optional watch mode.
 *
 * @param name - Connector name (e.g. 'hubspot', 'salesforce')
 * @param watch - Enable live-reload via vitest --watch
 */
export async function runConnectorTest(name: string, watch = false): Promise<void> {
  const connectorDir = resolve(IRIS_ROOT, 'packages/connectors', name);

  if (!existsSync(connectorDir)) {
    console.error(`Connector not found: ${name}`);
    console.error(`Expected directory: ${connectorDir}`);
    console.error('\nAvailable connectors:');
    try {
      const available = execSync('ls packages/connectors', { cwd: IRIS_ROOT, encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      for (const c of available) console.error(`  • ${c}`);
    } catch {
      console.error('  (could not list connectors)');
    }
    process.exit(1);
  }

  console.log(`\n▶ Running tests for connector: ${name}${watch ? ' [watch mode]' : ''}`);
  console.log(`  Directory: ${connectorDir}\n`);

  const vitestArgs = ['vitest', watch ? '--watch' : 'run', '--reporter=verbose'];

  const child = spawn('npx', vitestArgs, {
    cwd: connectorDir,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  await new Promise<void>((resolve, reject) => {
    child.on('close', code => {
      if (code === 0 || watch) resolve();
      else reject(new Error(`Tests exited with code ${code}`));
    });
    child.on('error', reject);
  });
}
