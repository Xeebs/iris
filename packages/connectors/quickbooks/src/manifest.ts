import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'quickbooks',
  name: 'QuickBooks',
  description: 'Customers, vendors, invoices, and expenses from QuickBooks Online',
  icon: 'quickbooks.svg',
  auth: {
    type: 'oauth2',
    scopes: ['com.intuit.quickbooks.accounting'],
  },
  entityTypes: ['customer', 'vendor', 'invoice', 'expense'],
  configSchema: z.object({
    realmId: z.string().min(1).describe('QuickBooks company ID (realmId)'),
  }),
  rateLimits: { requestsPerSecond: 1 },
};
