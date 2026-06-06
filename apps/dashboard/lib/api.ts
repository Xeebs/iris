const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

export interface ApiResponse<T> {
  data: T;
  meta?: { nextCursor?: string; hasMore?: boolean };
}

export interface ApiError {
  error: { code: string; message: string };
}

export interface ConnectorManifest {
  id: string;
  name: string;
  description: string;
  icon: string;
  entityTypes: string[];
}

export interface ConnectorInstance {
  id: string;
  connectorId: string;
  workspaceId: string;
  status: 'active' | 'error' | 'syncing';
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  workspaceId: string;
  toolName: string;
  query: string | null;
  tokenEstimate: number;
  cacheHit: boolean;
  durationMs: number;
  createdAt: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  const body = await res.json() as T | ApiError;
  if (!res.ok) throw new Error((body as ApiError).error?.message ?? 'API error');
  return body as T;
}

/**
 * Fetch all available connector manifests.
 */
export async function listConnectors(): Promise<ApiResponse<ConnectorManifest[]>> {
  return apiFetch<ApiResponse<ConnectorManifest[]>>('/connectors');
}

/**
 * Fetch audit log records for a workspace.
 *
 * @param workspaceId - Workspace to fetch audit log for
 * @param cursor      - Pagination cursor from previous response
 */
export async function listAuditRecords(
  workspaceId: string,
  cursor?: string,
): Promise<ApiResponse<AuditRecord[]>> {
  const params = new URLSearchParams({ workspaceId, limit: '50' });
  if (cursor) params.set('cursor', cursor);
  return apiFetch<ApiResponse<AuditRecord[]>>(`/audit?${params.toString()}`);
}

/**
 * Trigger a sync for a connector instance.
 *
 * @param instanceId - Connector instance ID to sync
 */
export async function triggerSync(instanceId: string): Promise<void> {
  await apiFetch<unknown>(`/connectors/${instanceId}/sync`, { method: 'POST' });
}

/**
 * Test connector health.
 *
 * @param instanceId - Connector instance ID to test
 */
export async function testConnector(instanceId: string): Promise<{ healthy: boolean; latencyMs: number }> {
  const res = await apiFetch<ApiResponse<{ healthy: boolean; latencyMs: number }>>(
    `/connectors/${instanceId}/test`,
    { method: 'POST' },
  );
  return res.data;
}

export interface ConnectorHealthSummary {
  instanceId: string;
  workspaceId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

/**
 * Fetch the latest health status for all connector instances in a workspace.
 *
 * @param workspaceId - Workspace to fetch health data for
 */
export async function getAllConnectorHealth(workspaceId: string): Promise<ConnectorHealthSummary[]> {
  const params = new URLSearchParams({ workspaceId });
  const res = await apiFetch<ApiResponse<ConnectorHealthSummary[]>>(`/connectors/health?${params.toString()}`);
  return res.data;
}

/**
 * Fetch the latest health status for a single connector instance.
 *
 * @param instanceId  - Connector instance ID
 * @param workspaceId - Workspace to scope the request
 */
export async function getConnectorHealth(instanceId: string, workspaceId: string): Promise<ConnectorHealthSummary | null> {
  const params = new URLSearchParams({ workspaceId });
  try {
    const res = await apiFetch<ApiResponse<ConnectorHealthSummary>>(`/connectors/${instanceId}/health?${params.toString()}`);
    return res.data;
  } catch {
    return null;
  }
}

export interface DailyTokenSummary {
  date: string;
  tokensSpent: number;
  tokensSavedByCaching: number;
  tokensSavedByCompression: number;
  totalTokensSaved: number;
  queryCount: number;
  cacheHitRate: number;
}

export interface TokenAnalyticsSummary {
  days: DailyTokenSummary[];
  totals: {
    tokensSpent: number;
    tokensSaved: number;
    cacheHitRate: number;
    compressionRatio: number;
  };
}

/**
 * Fetch token analytics for a workspace.
 *
 * @param workspaceId - Workspace ID
 * @param days - Number of days of history (default 30)
 */
export async function getTokenAnalytics(
  workspaceId: string,
  days = 30,
): Promise<ApiResponse<TokenAnalyticsSummary>> {
  const params = new URLSearchParams({ workspaceId, days: String(days) });
  return apiFetch<ApiResponse<TokenAnalyticsSummary>>(`/analytics/tokens?${params.toString()}`);
}
