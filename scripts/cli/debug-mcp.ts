import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const IRIS_ROOT = resolve(import.meta.dirname, '../..');

/**
 * Start the MCP server in debug mode with verbose logging to stdout.
 * Sets LOG_LEVEL=debug and DEBUG=iris:* for maximum verbosity.
 */
export async function runMcpDebug(): Promise<void> {
  const mcpDir = resolve(IRIS_ROOT, 'apps/mcp-server');

  console.log('\n▶ Starting MCP server in debug mode');
  console.log('  Press Ctrl+C to stop\n');
  console.log('  Environment:');
  console.log('    LOG_LEVEL=debug');
  console.log('    DEBUG=iris:*');
  console.log('    MCP_DEBUG=true\n');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOG_LEVEL: 'debug',
    DEBUG: 'iris:*',
    MCP_DEBUG: 'true',
    FORCE_COLOR: '1',
  };

  const child = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: mcpDir,
    stdio: 'inherit',
    env,
  });

  await new Promise<void>((_, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      if (code !== null && code !== 0 && code !== 130) {
        reject(new Error(`MCP server exited with code ${code}`));
      }
    });
    process.on('SIGINT', () => {
      child.kill('SIGTERM');
    });
  }).catch(() => {
    // SIGINT is expected — exit cleanly
  });
}
