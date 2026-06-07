import type postgres from 'postgres';
import type { Redis } from 'ioredis';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'health' });

export type HealthCheckResult = {
  status: 'ok' | 'degraded';
  checks: {
    db: boolean;
    redis: boolean;
  };
  timestamp: string;
};

/**
 * Run liveness checks against Postgres and Redis.
 * Returns partial results — never throws.
 *
 * @param sql - Postgres client
 * @param redis - Redis client (optional — omitted in dev mode)
 */
export async function checkHealth(
  sql: ReturnType<typeof postgres>,
  redis?: InstanceType<typeof Redis>,
): Promise<HealthCheckResult> {
  const checks = { db: false, redis: false };

  try {
    await (sql as unknown as { unsafe: (q: string) => Promise<unknown> }).unsafe('SELECT 1');
    checks.db = true;
  } catch (e) {
    log.warn('Health check: DB unreachable', { error: e instanceof Error ? e.message : String(e) });
  }

  if (redis) {
    try {
      const pong = await redis.ping();
      checks.redis = pong === 'PONG';
    } catch (e) {
      log.warn('Health check: Redis unreachable', { error: e instanceof Error ? e.message : String(e) });
    }
  } else {
    checks.redis = true;
  }

  return {
    status: checks.db && checks.redis ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  };
}
