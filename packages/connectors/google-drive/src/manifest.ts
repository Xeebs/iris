import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';

export const manifest: ConnectorManifest = {
  id: 'google-drive',
  name: 'Google Drive',
  description: 'Files, folders, and document content from Google Drive',
  icon: 'google-drive.svg',
  auth: {
    type: 'oauth2',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ],
  },
  entityTypes: ['file', 'folder'],
  configSchema: z.object({}),
  rateLimits: { requestsPerSecond: 10 },
};
