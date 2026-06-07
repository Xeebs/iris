import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'mcp-shutdown' });

const SHUTDOWN_TIMEOUT_MS = 30_000;

export type ShutdownHandler = () => Promise<void>;

/**
 * Register SIGTERM and SIGINT handlers that run cleanup tasks and exit.
 *
 * A 30-second hard timeout forces exit if cleanup hangs.
 *
 * @param onShutdown - Async cleanup function (close DB, Redis, flush logs)
 */
export function registerGracefulShutdown(onShutdown: ShutdownHandler): void {
  let shutdownInProgress = false;

  async function handleSignal(signal: string) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    log.info(`Received ${signal} — starting graceful shutdown`);

    const timeout = setTimeout(() => {
      log.error('Graceful shutdown timed out after 30s — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    timeout.unref();

    try {
      await onShutdown();
      log.info('Graceful shutdown complete');
      clearTimeout(timeout);
      process.exit(0);
    } catch (e) {
      log.error('Error during shutdown', { error: e instanceof Error ? e.message : String(e) });
      clearTimeout(timeout);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void handleSignal('SIGTERM'));
  process.on('SIGINT', () => void handleSignal('SIGINT'));
}
