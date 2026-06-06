import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'netsuite',
  name: 'NetSuite',
  description: 'Customers, vendors, items, and transactions from NetSuite ERP',
  icon: 'netsuite.svg',
  auth: {
    type: 'oauth2',
    scopes: ['restlets', 'rest_webservices'],
  },
  entityTypes: ['customer', 'vendor', 'item', 'transaction'],
  configSchema: z.object({
    accountId: z.string().min(1).describe('NetSuite account ID (e.g., 12345678)'),
  }),
  rateLimits: { requestsPerSecond: 5 },
};
