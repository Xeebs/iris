import type { APIRequestContext } from '@playwright/test';

export const API_URL = process.env['API_URL'] ?? 'http://localhost:3001';
export const MCP_API_KEY = process.env['TEST_MCP_API_KEY'] ?? 'iris_test_key';
export const TEST_WORKSPACE_ID = process.env['TEST_WORKSPACE_ID'] ?? 'ws-e2e-test';
export const AUTH_HEADER = process.env['TEST_AUTH_TOKEN']
  ? { Authorization: `Bearer ${process.env['TEST_AUTH_TOKEN']}` }
  : {};

export type ConnectorInstance = {
  id: string;
  workspaceId: string;
  connectorId: string;
  status: string;
};

/**
 * Create a connector instance via the REST API.
 */
export async function createConnectorInstance(
  request: APIRequestContext,
  params: { connectorId: string; config: Record<string, unknown>; workspaceId?: string },
): Promise<ConnectorInstance> {
  const response = await request.post(`${API_URL}/api/v1/connectors`, {
    headers: AUTH_HEADER,
    data: {
      connectorId: params.connectorId,
      workspaceId: params.workspaceId ?? TEST_WORKSPACE_ID,
      config: params.config,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `Failed to create connector instance: ${response.status()} ${await response.text()}`,
    );
  }

  const body = await response.json() as { data: ConnectorInstance };
  return body.data;
}

/**
 * Delete a connector instance via the REST API.
 */
export async function deleteConnectorInstance(
  request: APIRequestContext,
  instanceId: string,
): Promise<void> {
  await request.delete(`${API_URL}/api/v1/connectors/${instanceId}`, {
    headers: AUTH_HEADER,
  });
}

/** Auth headers for a specific workspace — used in multi-tenant isolation tests. */
export function workspaceAuthHeaders(workspaceId: string, token?: string): Record<string, string> {
  const base = token ? { Authorization: `Bearer ${token}` } : {};
  return { ...base, 'x-workspace-id': workspaceId };
}

export type WorkspaceCredentials = {
  workspaceId: string;
  apiKey: string;
  authHeaders: Record<string, string>;
};

/**
 * Register a workspace (idempotent) and return credentials for E2E tests.
 * Uses TEST_WORKSPACE_A_ID / TEST_WORKSPACE_B_ID env vars when set.
 */
export function getWorkspaceA(): WorkspaceCredentials {
  const workspaceId = process.env['TEST_WORKSPACE_A_ID'] ?? 'ws-e2e-alpha';
  const apiKey = process.env['TEST_WORKSPACE_A_KEY'] ?? 'iris_alpha_key';
  return { workspaceId, apiKey, authHeaders: { 'x-api-key': apiKey, 'x-workspace-id': workspaceId } };
}

export function getWorkspaceB(): WorkspaceCredentials {
  const workspaceId = process.env['TEST_WORKSPACE_B_ID'] ?? 'ws-e2e-beta';
  const apiKey = process.env['TEST_WORKSPACE_B_KEY'] ?? 'iris_beta_key';
  return { workspaceId, apiKey, authHeaders: { 'x-api-key': apiKey, 'x-workspace-id': workspaceId } };
}

/**
 * Fetch a glossary term for a specific workspace.
 */
export async function getGlossaryTerm(
  request: APIRequestContext,
  workspaceId: string,
  term: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  const res = await request.get(
    `${API_URL}/api/v1/glossary/${term}?workspaceId=${workspaceId}`,
    { headers },
  );
  return res;
}

/**
 * Trigger a connector sync and wait for the job to be queued.
 */
export async function triggerSync(
  request: APIRequestContext,
  instanceId: string,
  workspaceId = TEST_WORKSPACE_ID,
): Promise<{ jobId: string; status: string }> {
  const response = await request.post(
    `${API_URL}/api/v1/connectors/${instanceId}/sync?workspaceId=${workspaceId}`,
    { headers: AUTH_HEADER },
  );

  if (!response.ok()) {
    throw new Error(`Sync trigger failed: ${response.status()} ${await response.text()}`);
  }

  const body = await response.json() as { data: { jobId: string; status: string } };
  return body.data;
}
