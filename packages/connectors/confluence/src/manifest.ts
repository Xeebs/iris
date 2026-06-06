import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'confluence',
  name: 'Confluence',
  description: 'Pages, spaces, and content from Confluence Cloud',
  icon: 'confluence.svg',
  auth: {
    type: 'oauth2',
    scopes: [
      'read:confluence-space.summary',
      'read:confluence-content.all',
      'read:confluence-user',
      'offline_access',
    ],
  },
  entityTypes: ['space', 'page'],
  configSchema: z.object({ cloudId: z.string().min(1) }),
  rateLimits: { requestsPerSecond: 10 },
};
