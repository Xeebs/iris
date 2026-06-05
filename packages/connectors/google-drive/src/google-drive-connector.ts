import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformFile } from './transformers.js';
import type { GoogleDriveFile } from './transformers.js';

export { manifest };

const configSchema = z.object({});
export type GoogleDriveConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface DriveListResponse {
  files: GoogleDriveFile[];
  nextPageToken?: string;
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
const TEXT_MIME_PREFIX = 'text/';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,size,description,webViewLink';

export class GoogleDriveConnector extends BaseConnector<GoogleDriveConfig> {
  private tokens: OAuthTokens | null = null;
  private readonly log = logger.child({ connector: 'google-drive' });

  /**
   * @param config - Workspace-level config (no extra fields required for Drive)
   * @returns Result<void, ConnectorError>
   */
  async connect(config: GoogleDriveConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid Google Drive config', 'INVALID_CONFIG', false));
    }

    if (!this.tokens) {
      return err(new ConnectorError(
        'No OAuth tokens available. Complete OAuth flow before calling connect().',
        'AUTH_MISSING',
        false,
      ));
    }

    const now = new Date();
    if (this.tokens.expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      return err(new ConnectorError('Access token is expired — re-authenticate via OAuth', 'TOKEN_EXPIRED', false));
    }

    this.log.info('Connected to Google Drive');
    return ok(undefined);
  }

  /** Inject tokens directly (used in tests and OAuth callback handlers). */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  /**
   * @param options - Sync options including lastSyncedAt cursor and entityTypes filter
   * @returns AsyncGenerator yielding SemanticEntity objects
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    const types = options.entityTypes ?? ['file', 'folder'];

    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      const query = this.buildQuery(options, types);
      const params = new URLSearchParams({
        pageSize: String(PAGE_SIZE),
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        q: query,
      });
      if (pageToken) params.set('pageToken', pageToken);

      const data = await this.get<DriveListResponse>(`/files?${params}`);
      pageCount++;
      this.log.debug('Synced Google Drive page', { page: pageCount, count: data.files.length });

      for (const file of data.files) {
        const content = await this.fetchContent(file);
        yield transformFile(file, content);
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  /**
   * @returns ConnectorSchema describing file and folder entity types
   */
  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'file',
          attributes: [
            { name: 'mimeType', type: 'string', nullable: false },
            { name: 'description', type: 'string', nullable: true },
            { name: 'size', type: 'number', nullable: true },
            { name: 'webViewLink', type: 'string', nullable: true },
            { name: 'content', type: 'string', nullable: true },
            { name: 'isGoogleDoc', type: 'boolean', nullable: false },
          ],
        },
        {
          name: 'folder',
          attributes: [
            { name: 'mimeType', type: 'string', nullable: false },
            { name: 'description', type: 'string', nullable: true },
            { name: 'webViewLink', type: 'string', nullable: true },
          ],
        },
      ],
      version: manifest.id + '@1.0.0',
    };
  }

  /**
   * @returns HealthStatus with latency measurement
   */
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.get('/about?fields=user');
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
        checkedAt: new Date(),
      };
    }
  }

  private buildQuery(options: SyncOptions, types: string[]): string {
    const parts: string[] = ['trashed = false'];

    if (options.lastSyncedAt) {
      const iso = options.lastSyncedAt.toISOString();
      parts.push(`modifiedTime >= '${iso}'`);
    }

    if (types.length === 1) {
      if (types[0] === 'folder') {
        parts.push("mimeType = 'application/vnd.google-apps.folder'");
      } else {
        parts.push("mimeType != 'application/vnd.google-apps.folder'");
      }
    }

    return parts.join(' AND ');
  }

  private async fetchContent(file: GoogleDriveFile): Promise<string | undefined> {
    if (file.mimeType.startsWith(TEXT_MIME_PREFIX)) {
      try {
        const response = await this.rawGet(`/files/${file.id}?alt=media`);
        if (response.ok) {
          const text = await response.text();
          return text.slice(0, 4000);
        }
      } catch {
        this.log.debug('Failed to fetch text file content', { fileId: file.id });
      }
    }

    if (file.mimeType === GOOGLE_DOC_MIME || file.mimeType === GOOGLE_SHEET_MIME) {
      try {
        const response = await this.rawGet(`/files/${file.id}/export?mimeType=text/plain`);
        if (response.ok) {
          const text = await response.text();
          return text.slice(0, 4000);
        }
      } catch {
        this.log.debug('Failed to export Google Doc content', { fileId: file.id });
      }
    }

    return undefined;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.rawGet(path);

    if (response.status === 401) {
      throw new ConnectorError('Google Drive auth failed — token may be expired', 'AUTH_EXPIRED', true);
    }
    if (response.status === 429) {
      throw new ConnectorError('Google Drive rate limit exceeded', 'RATE_LIMITED', true);
    }
    if (!response.ok) {
      throw new ConnectorError(`Google Drive API error: ${response.status} ${response.statusText}`, 'API_ERROR', response.status >= 500);
    }

    return response.json() as Promise<T>;
  }

  private async rawGet(path: string): Promise<Response> {
    if (!this.tokens) {
      throw new ConnectorError('Not authenticated', 'AUTH_MISSING', false);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const url = path.startsWith('http') ? path : `${DRIVE_API_BASE}${path}`;
      return await fetch(url, {
        headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
