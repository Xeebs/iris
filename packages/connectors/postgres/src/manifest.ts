import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'postgres',
  name: 'PostgreSQL',
  description: 'Sync rows from user-configured Postgres tables as semantic entities',
  icon: 'postgres.svg',
  auth: { type: 'api_key' as never },
  entityTypes: ['row'],
  configSchema: z.object({
    connectionString: z.string().min(1),
    tables: z
      .array(
        z.object({
          name: z.string().min(1),
          entityType: z.string().min(1).default('row'),
          updatedAtColumn: z.string().optional(),
          labelColumn: z.string().optional(),
        }),
      )
      .min(1),
  }),
  rateLimits: { requestsPerSecond: 50 },
};
