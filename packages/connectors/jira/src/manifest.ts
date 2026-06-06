import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'jira',
  name: 'Jira',
  description: 'Projects, issues, epics, and sprints from Jira Cloud',
  icon: 'jira.svg',
  auth: {
    type: 'oauth2',
    scopes: [
      'read:jira-user',
      'read:jira-work',
      'offline_access',
    ],
  },
  entityTypes: ['project', 'issue'],
  configSchema: z.object({ cloudId: z.string().min(1) }),
  rateLimits: { requestsPerSecond: 10 },
};
