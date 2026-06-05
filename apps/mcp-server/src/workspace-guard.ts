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
