import type { APIRequestContext } from '@playwright/test';

export const API_URL = process.env['API_URL'] ?? 'http://localhost:3001';
export const MCP_API_KEY_HEADER = 'X-Iris-Api-Key';

/**
 * Create a test MCP API key via the REST API and return it for use in MCP tests.
 * The key is scoped to the given workspaceId.
 */
export async function createTestApiKey(
  request: APIRequestContext,
  workspaceId: string,
  authHeaders: Record<string, string>,
): Promise<{ rawKey: string; keyId: string }> {
  const response = await request.post(`${API_URL}/api/v1/api-keys`, {
    headers: authHeaders,
    data: { workspaceId, displayName: 'e2e-test-key' },
  });

  if (!response.ok()) {
    throw new Error(`Failed to create API key: ${response.status()} ${await response.text()}`);
  }

  const body = await response.json() as { data: { rawKey: string; keyId: string } };
  return body.data;
}

/**
 * Revoke an MCP API key after the test.
 */
export async function revokeTestApiKey(
  request: APIRequestContext,
  keyId: string,
  authHeaders: Record<string, string>,
): Promise<void> {
  await request.delete(`${API_URL}/api/v1/api-keys/${keyId}`, { headers: authHeaders });
}

/**
 * Build the env object that should be passed to the MCP server process for authentication.
 */
export function buildMcpEnv(apiKey: string): Record<string, string> {
  return { IRIS_API_KEY: apiKey };
}
