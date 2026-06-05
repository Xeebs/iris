import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'notion',
  name: 'Notion',
  description: 'Notion pages and database records',
  icon: 'notion.svg',
  auth: { type: 'oauth2', scopes: ['read_content'] },
  entityTypes: ['page', 'database_row'],
  configSchema: z.object({}),
  rateLimits: { requestsPerSecond: 3 },
};
