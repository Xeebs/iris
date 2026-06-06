import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'linear',
  name: 'Linear',
  description: 'Issues, projects, and cycles from Linear',
  icon: 'linear.svg',
  auth: {
    type: 'oauth2',
    scopes: ['read'],
  },
  entityTypes: ['issue', 'project', 'cycle'],
  configSchema: z.object({}),
  rateLimits: { requestsPerSecond: 10 },
};
