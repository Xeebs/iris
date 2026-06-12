/**
 * Checks that a tool request's workspaceId matches the authenticated workspace.
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
 * Resolve the effective workspace ID for a tool call.
 *
 * - Caller provides no workspaceId + key is authenticated → use the key's workspace (the happy path)
 * - Caller provides a workspaceId that matches the key → accept it
 * - Caller provides a workspaceId that doesn't match the key → structured error (cross-workspace attempt)
 * - No workspaceId and no authenticated key (dev mode) → structured error (required in dev mode)
 *
 * @param requestedId - workspaceId from tool input, or undefined if not provided
 * @param authenticatedId - workspaceId from the validated API key, or null in dev mode
 */
export function resolveWorkspace(
  requestedId: string | undefined,
  authenticatedId: string | null,
): { workspaceId: string } | { error: string } {
  if (requestedId !== undefined) {
    if (authenticatedId !== null && requestedId !== authenticatedId) {
      return { error: `Access denied: workspace "${requestedId}" is not accessible with this API key` };
    }
    return { workspaceId: requestedId };
  }
  if (authenticatedId !== null) {
    return { workspaceId: authenticatedId };
  }
  return { error: 'workspaceId is required when running in unauthenticated mode' };
}
