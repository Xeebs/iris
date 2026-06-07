import { randomUUID } from 'crypto';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from './logger.js';

const log = logger.child({ service: 'session-manager' });

const MAX_SESSIONS_PER_USER = 5;
const SESSION_EXPIRY_DAYS = 30;

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserSession = {
  id: string;
  workspaceId: string;
  userId: string;
  deviceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  browserName: string | null;
  osName: string | null;
  countryCode: string | null;
  isActive: boolean;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type TrustedDevice = {
  id: string;
  userId: string;
  workspaceId: string;
  deviceName: string | null;
  fingerprint: string;
  trustedAt: Date;
  lastUsedAt: Date;
};

export type CreateSessionOptions = {
  userId: string;
  workspaceId: string;
  ipAddress?: string;
  userAgent?: string;
  browserName?: string;
  osName?: string;
  countryCode?: string;
  deviceFingerprint?: string;
};

// ─── SessionManager ───────────────────────────────────────────────────────────

/**
 * Manages user sessions and trusted device tracking.
 * Enforces a per-user concurrent session limit (5) and 30-day inactivity expiry.
 */
export class SessionManager {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Create a new session for a user. Enforces MAX_SESSIONS_PER_USER by revoking the oldest
   * active session when the limit is reached.
   *
   * @param options - Session creation parameters
   * @returns Newly created session
   */
  async createSession(options: CreateSessionOptions): Promise<Result<UserSession, Error>> {
    try {
      // Check concurrent session limit
      const countRows = await this.sql`
        SELECT COUNT(*)::int AS cnt
        FROM user_sessions
        WHERE user_id = ${options.userId} AND workspace_id = ${options.workspaceId}
          AND is_active = true AND expires_at > now()
      ` as { cnt: number }[];
      const activeCount = countRows[0]?.cnt ?? 0;

      if (activeCount >= MAX_SESSIONS_PER_USER) {
        // Revoke the oldest active session
        await this.sql`
          UPDATE user_sessions SET is_active = false, revoked_at = now()
          WHERE id = (
            SELECT id FROM user_sessions
            WHERE user_id = ${options.userId} AND workspace_id = ${options.workspaceId}
              AND is_active = true
            ORDER BY last_activity_at ASC
            LIMIT 1
          )
        `;
        log.info('Oldest session revoked due to concurrent session limit', { userId: options.userId });
      }

      // Resolve device ID from fingerprint (or create a new trusted device record)
      let deviceId: string | null = null;
      if (options.deviceFingerprint) {
        const devRows = await this.sql`
          SELECT id FROM trusted_devices
          WHERE user_id = ${options.userId} AND fingerprint = ${options.deviceFingerprint}
        ` as { id: string }[];
        if (devRows.length > 0) {
          deviceId = devRows[0]!.id;
          await this.sql`
            UPDATE trusted_devices SET last_used_at = now()
            WHERE id = ${deviceId}
          `;
        }
      }

      const rows = await this.sql`
        INSERT INTO user_sessions (
          workspace_id, user_id, device_id,
          ip_address, user_agent, browser_name, os_name, country_code,
          expires_at
        )
        VALUES (
          ${options.workspaceId}, ${options.userId}, ${deviceId},
          ${options.ipAddress ?? null}, ${options.userAgent ?? null},
          ${options.browserName ?? null}, ${options.osName ?? null},
          ${options.countryCode ?? null},
          now() + INTERVAL '30 days'
        )
        RETURNING *
      ` as Record<string, unknown>[];

      log.info('Session created', { userId: options.userId, workspaceId: options.workspaceId });
      return ok(mapSessionRow(rows[0]!));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Refresh a session by updating its last_activity_at and extending expiry.
   *
   * @param sessionId - Session UUID
   * @returns Updated session or error if not found/expired
   */
  async refreshSession(sessionId: string): Promise<Result<UserSession, Error>> {
    try {
      const rows = await this.sql`
        UPDATE user_sessions SET
          last_activity_at = now(),
          expires_at = now() + INTERVAL '30 days'
        WHERE id = ${sessionId} AND is_active = true AND expires_at > now()
        RETURNING *
      ` as Record<string, unknown>[];
      if (rows.length === 0) return err(new Error('Session not found or expired'));
      return ok(mapSessionRow(rows[0]!));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Revoke a single session.
   *
   * @param sessionId - Session UUID
   */
  async revokeSession(sessionId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE user_sessions SET is_active = false, revoked_at = now()
        WHERE id = ${sessionId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all active sessions for a user.
   *
   * @param userId - User identifier
   * @param workspaceId - Tenant workspace
   */
  async getActiveSessions(userId: string, workspaceId: string): Promise<Result<UserSession[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM user_sessions
        WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
          AND is_active = true AND expires_at > now()
        ORDER BY last_activity_at DESC
      ` as Record<string, unknown>[];
      return ok(rows.map(mapSessionRow));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Register a device fingerprint as trusted for a user.
   *
   * @param userId - User identifier
   * @param workspaceId - Tenant workspace
   * @param fingerprint - Device fingerprint hash
   * @param deviceName - Human-readable name (e.g. "MacBook Pro")
   */
  async trustDevice(
    userId: string,
    workspaceId: string,
    fingerprint: string,
    deviceName?: string,
  ): Promise<Result<TrustedDevice, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO trusted_devices (user_id, workspace_id, fingerprint, device_name)
        VALUES (${userId}, ${workspaceId}, ${fingerprint}, ${deviceName ?? null})
        ON CONFLICT (user_id, fingerprint) DO UPDATE SET
          last_used_at = now(),
          device_name = COALESCE(EXCLUDED.device_name, trusted_devices.device_name)
        RETURNING *
      ` as Record<string, unknown>[];
      return ok(mapDeviceRow(rows[0]!));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List trusted devices for a user.
   *
   * @param userId - User identifier
   * @param workspaceId - Tenant workspace
   */
  async getTrustedDevices(userId: string, workspaceId: string): Promise<Result<TrustedDevice[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM trusted_devices
        WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
        ORDER BY last_used_at DESC
      ` as Record<string, unknown>[];
      return ok(rows.map(mapDeviceRow));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Revoke trust from a device (does not invalidate existing sessions).
   *
   * @param deviceId - Device UUID
   * @param userId - Owner user ID (prevents unauthorized removal)
   */
  async revokeDevice(deviceId: string, userId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM trusted_devices WHERE id = ${deviceId} AND user_id = ${userId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Detects whether a new session is from a previously unseen country.
   * Returns true if the country is new (potential geo-anomaly).
   *
   * @param userId - User identifier
   * @param workspaceId - Tenant workspace
   * @param countryCode - ISO-3166 country code of the new session
   */
  async isNewCountry(userId: string, workspaceId: string, countryCode: string): Promise<boolean> {
    try {
      const rows = await this.sql`
        SELECT 1 FROM user_sessions
        WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
          AND country_code = ${countryCode}
          AND id NOT IN (
            SELECT id FROM user_sessions
            WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
            ORDER BY created_at DESC LIMIT 1
          )
        LIMIT 1
      ` as unknown[];
      return rows.length === 0;
    } catch {
      return false;
    }
  }

  /**
   * Expire sessions that have passed their inactivity deadline.
   * Should be called periodically by a background job.
   */
  async expireInactiveSessions(): Promise<void> {
    try {
      const result = await this.sql`
        UPDATE user_sessions SET is_active = false, revoked_at = now()
        WHERE is_active = true AND expires_at <= now()
        RETURNING id
      ` as { id: string }[];
      if (result.length > 0) {
        log.info('Expired inactive sessions', { count: result.length });
      }
    } catch {
      log.warn('Failed to expire inactive sessions (non-fatal)');
    }
  }
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

function mapSessionRow(r: Record<string, unknown>): UserSession {
  return {
    id: r['id'] as string,
    workspaceId: r['workspace_id'] as string,
    userId: r['user_id'] as string,
    deviceId: r['device_id'] as string | null,
    ipAddress: r['ip_address'] as string | null,
    userAgent: r['user_agent'] as string | null,
    browserName: r['browser_name'] as string | null,
    osName: r['os_name'] as string | null,
    countryCode: r['country_code'] as string | null,
    isActive: r['is_active'] as boolean,
    createdAt: new Date(r['created_at'] as string),
    lastActivityAt: new Date(r['last_activity_at'] as string),
    expiresAt: new Date(r['expires_at'] as string),
    revokedAt: r['revoked_at'] ? new Date(r['revoked_at'] as string) : null,
  };
}

function mapDeviceRow(r: Record<string, unknown>): TrustedDevice {
  return {
    id: r['id'] as string,
    userId: r['user_id'] as string,
    workspaceId: r['workspace_id'] as string,
    deviceName: r['device_name'] as string | null,
    fingerprint: r['fingerprint'] as string,
    trustedAt: new Date(r['trusted_at'] as string),
    lastUsedAt: new Date(r['last_used_at'] as string),
  };
}

// Re-export for convenience
export { randomUUID };
