import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'salesforce',
  name: 'Salesforce',
  description: 'CRM contacts, accounts, and opportunities',
  icon: 'salesforce.svg',
  auth: {
    type: 'oauth2',
    scopes: ['api', 'refresh_token'],
  },
  entityTypes: ['contact', 'account', 'opportunity'],
  configSchema: z.object({ instanceUrl: z.string().url() }),
  rateLimits: { requestsPerSecond: 10 },
};
