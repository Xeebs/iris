import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'airtable',
  name: 'Airtable',
  description: 'Airtable bases, tables, and records as searchable entities',
  icon: 'airtable.svg',
  auth: {
    type: 'oauth2',
    scopes: ['data.records:read', 'schema.bases:read'],
  },
  entityTypes: ['base', 'record'],
  configSchema: z.object({
    baseIds: z
      .array(z.string().min(1))
      .optional()
      .describe('Optional list of base IDs to sync. Defaults to all accessible bases.'),
  }),
  rateLimits: { requestsPerSecond: 5 },
};
