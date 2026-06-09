import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM contacts, companies, deals, and activities',
  icon: 'hubspot.svg',
  auth: { type: 'oauth2', scopes: ['contacts', 'crm.objects.deals.read', 'crm.objects.companies.read'] },
  entityTypes: ['contact', 'company', 'deal'],
  configSchema: z.object({ portalId: z.string().min(1), demoMode: z.boolean().optional() }),
  rateLimits: { requestsPerSecond: 10 },
};
