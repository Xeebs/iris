import type { Metadata } from 'next';
import { WorkspaceManagementPanel } from '@/components/workspace-management-panel';

export const metadata: Metadata = { title: 'Workspaces — Iris Admin' };

interface Workspace {
  id: string;
  name: string;
  created_at: string;
  connector_count: number;
  mcp_query_volume: number;
  last_mcp_query_at: string | null;
  status?: string;
}

async function fetchWorkspaces(apiBase: string): Promise<Workspace[]> {
  try {
    const res = await fetch(`${apiBase}/api/v1/admin/workspaces?limit=200`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { data: Workspace[] };
    return body.data;
  } catch {
    return [];
  }
}

export default async function AdminWorkspacesPage() {
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001';
  const workspaces = await fetchWorkspaces(apiBase);

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
          Workspace Management
        </h1>
        <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
          {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''} total
        </p>
      </div>

      <WorkspaceManagementPanel workspaces={workspaces} />
    </div>
  );
}
