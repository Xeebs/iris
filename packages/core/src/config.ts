import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  QDRANT_URL: z.string().url('QDRANT_URL must be a valid URL').optional(),
  QDRANT_API_KEY: z.string().optional(),

  EMBEDDING_PROVIDER: z.enum(['openai', 'anthropic', 'local']).default('openai'),
  OPENAI_API_KEY: z.string().optional(),

  CLERK_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),

  MCP_SERVER_PORT: z.coerce.number().int().positive().default(3100),
  MCP_API_KEY_SECRET: z.string().optional(),

  CONNECTOR_TOKEN_ENCRYPTION_KEY: z.string().optional(),

  HUBSPOT_CLIENT_ID: z.string().optional(),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_CLIENT_SECRET: z.string().optional(),
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  ENABLE_SEMANTIC_CACHE: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  ENABLE_KNOWLEDGE_GRAPH: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  ENABLE_AUDIT_LOG: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type IrisConfig = z.infer<typeof configSchema>;

let _config: IrisConfig | undefined;

/**
 * Load and validate environment variables with zod.
 * Throws on first call if required vars are missing.
 * Returns the cached config on subsequent calls.
 */
export function loadConfig(): IrisConfig {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Missing or invalid environment variables:\n${issues}`);
  }

  _config = result.data;
  return _config;
}

/** Reset cached config — for use in tests only. */
export function _resetConfig(): void {
  _config = undefined;
}
