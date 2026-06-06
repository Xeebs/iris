import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { ApiKeyManager } from '@iris/semantic-core';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'mcp-auth' });

type SqlClient = ReturnType<typeof postgres>;

/**
 * Check that a tool request's workspaceId matches the authenticated workspace.
 * Returns an error message string if the check fails, or null if allowed.
 *
 * When no authenticated workspace is set (dev/single-tenant mode), all workspaces
 * are permitted and this function always returns null.
 *
 * @param requestedWorkspaceId - workspaceId from the tool input params
 * @param authenticatedWorkspaceId - workspaceId from the validated API key, or null
 */
export function assertWorkspace(
  requestedWorkspaceId: string,
  authenticatedWorkspaceId: string | null,
): string | null {
  if (authenticatedWorkspaceId === null) return null;
  if (requestedWorkspaceId !== authenticatedWorkspaceId) {
    return `Access denied: workspace "${requestedWorkspaceId}" is not accessible with this API key`;
  }
  return null;
}

/**
 * Validate the MCP server's API key against the database.
 * Called once at server startup — the key is read from IRIS_API_KEY env var.
 *
 * @param rawKey - Raw API key from environment
 * @param sql - Postgres client
 * @returns Authenticated workspace ID, key ID, and optional role ID
 */
export async function validateMcpApiKey(
  rawKey: string,
  sql: SqlClient,
): Promise<Result<{ workspaceId: string; keyId: string; roleId: string | null }, Error>> {
  const manager = new ApiKeyManager(sql);
  const result = await manager.validateKey(rawKey);
  if (result.isErr()) {
    log.error('MCP server API key validation failed', { error: result.error });
  }
  return result;
}

/**
 * Record an MCP session start in the audit table (fire-and-forget).
 *
 * @param sql - Postgres client
 * @param keyId - API key ID from validated key
 * @param workspaceId - Workspace ID
 * @returns Session ID for later closure
 */
export async function recordSessionStart(
  sql: SqlClient,
  keyId: string | null,
  workspaceId: string,
): Promise<string | null> {
  try {
    const [row] = await sql<Array<{ session_id: string }>>`
      INSERT INTO mcp_audit_sessions (api_key_id, workspace_id)
      VALUES (${keyId}, ${workspaceId})
      RETURNING session_id
    `;
    return row?.session_id ?? null;
  } catch (e) {
    log.warn('Failed to record session start', { error: e });
    return null;
  }
}

/**
 * Record an MCP session end in the audit table (fire-and-forget).
 *
 * @param sql - Postgres client
 * @param sessionId - Session ID from recordSessionStart
 */
export async function recordSessionEnd(sql: SqlClient, sessionId: string): Promise<void> {
  try {
    await sql`
      UPDATE mcp_audit_sessions
      SET disconnected_at = NOW()
      WHERE session_id = ${sessionId}
    `;
  } catch (e) {
    log.warn('Failed to record session end', { error: e });
  }
}
