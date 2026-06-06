import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'slack',
  name: 'Slack',
  description: 'Slack channels, users, and messages as searchable context',
  icon: 'slack.svg',
  auth: {
    type: 'oauth2',
    scopes: ['channels:read', 'users:read', 'channels:history'],
  },
  entityTypes: ['channel', 'user', 'message'],
  configSchema: z.object({
    channelIds: z
      .array(z.string().min(1))
      .optional()
      .describe('Optional list of channel IDs to sync. Defaults to all public channels.'),
    includeMessages: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to sync message history. Defaults to true.'),
    messageLookbackDays: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .default(30)
      .describe('Days of message history to sync on initial run.'),
  }),
  rateLimits: { requestsPerSecond: 1 },
};
