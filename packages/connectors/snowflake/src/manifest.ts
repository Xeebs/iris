import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

const tableConfigSchema = z.object({
  name: z.string().min(1),
  entityType: z.string().min(1).default('row'),
  updatedAtColumn: z.string().optional(),
  labelColumn: z.string().optional(),
});

export const manifest: ConnectorManifest = {
  id: 'snowflake',
  name: 'Snowflake',
  description: 'Sync rows from Snowflake tables as semantic entities',
  icon: 'snowflake.svg',
  auth: { type: 'api-key' },
  entityTypes: ['row'],
  configSchema: z.object({
    account: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
    warehouse: z.string().min(1),
    database: z.string().min(1),
    schema: z.string().min(1).default('PUBLIC'),
    tables: z.array(tableConfigSchema).min(1),
  }),
  rateLimits: { requestsPerSecond: 5 },
};
