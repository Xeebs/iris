import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'github',
  name: 'GitHub',
  description: 'Repositories, issues, pull requests, and discussions',
  icon: 'github.svg',
  auth: { type: 'oauth2', scopes: ['repo', 'read:org', 'read:discussion'] },
  entityTypes: ['repository', 'issue', 'pull_request', 'discussion'],
  configSchema: z.object({ owner: z.string().min(1) }),
  rateLimits: { requestsPerSecond: 10 },
};
