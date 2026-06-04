/**
 * Iris logger — structured logging with level control.
 *
 * Import via: import { logger } from '@iris/core/logger'
 *
 * Rules:
 * - Never use console.log in production code — use this logger
 * - Never log token values, API keys, OAuth tokens, or email addresses
 * - Always include structured metadata: { connectorId, workspaceId, durationMs, ... }
 *
 * @see .claude/rules/code-style.md#logging
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMetadata {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  child(context: LogMetadata): Logger;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function createLogger(baseContext: LogMetadata = {}): Logger {
  const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

  function log(level: LogLevel, message: string, metadata: LogMetadata = {}): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

    // Scrub sensitive keys before logging
    const safe = scrubSensitiveKeys({ ...baseContext, ...metadata });

    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...safe,
    };

    if (level === 'error') {
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      process.stdout.write(JSON.stringify(entry) + '\n');
    }
  }

  return {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    child: (context) => createLogger({ ...baseContext, ...context }),
  };
}

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /apiKey/i,
  /api_key/i,
  /authorization/i,
  /email/i,    // PII — log email domains only if needed
  /credit/i,
];

function scrubSensitiveKeys(obj: LogMetadata): LogMetadata {
  const result: LogMetadata = {};
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(k));
    result[k] = isSensitive ? '[REDACTED]' : v;
  }
  return result;
}

/** Singleton root logger. Use logger.child({ connectorId }) for scoped loggers. */
export const logger = createLogger();
