import type { Metadata } from 'next';
import { UserManagementPanel } from '@/components/user-management-panel';

export const metadata: Metadata = { title: 'Users — Iris Admin' };

interface User {
  user_id: string;
  role: string;
  workspace_id: string;
  workspace_name: string;
  invited_at: string;
  accepted_at: string | null;
  last_active_at: string | null;
}

async function fetchUsers(apiBase: string): Promise<User[]> {
  try {
    const res = await fetch(`${apiBase}/api/v1/admin/system/users?limit=200`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { data: User[] };
    return body.data;
  } catch {
    return [];
  }
}

export default async function AdminUsersPage() {
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001';
  const users = await fetchUsers(apiBase);

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
          User Management
        </h1>
        <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
          {users.length} user{users.length !== 1 ? 's' : ''} across all workspaces
        </p>
      </div>

      <UserManagementPanel users={users} />
    </div>
  );
}
