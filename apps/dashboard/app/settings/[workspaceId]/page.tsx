'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { WorkspaceInfo } from '../../../components/workspace-info.js';
import { TeamMemberList, type TeamMember } from '../../../components/team-member-list.js';
import { TeamInviteForm } from '../../../components/team-invite-form.js';
import { ApiKeyManager, type ApiKey } from '../../../components/api-key-manager.js';
import { BillingCard } from '../../../components/billing-card.js';

const TABS = [
  { id: 'info', label: 'Basic Info' },
  { id: 'team', label: 'Team' },
  { id: 'apikeys', label: 'API Keys' },
  { id: 'billing', label: 'Billing' },
  { id: 'privacy', label: 'Data & Privacy' },
] as const;

type TabId = (typeof TABS)[number]['id'];

interface WorkspaceData {
  id: string;
  name: string;
  ownerEmail: string;
  plan: string;
  createdAt: string;
  entityCount?: number;
  queryCount?: number;
  entityLimit?: number;
  queryLimit?: number;
}

export default function WorkspaceSettingsPage({
  params,
}: {
  params: { workspaceId: string };
}): React.JSX.Element {
  const { workspaceId } = params;
  const [activeTab, setActiveTab] = useState<TabId>('info');
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wsRes, membersRes, keysRes] = await Promise.all([
        fetch(`${apiUrl}/workspace/settings?workspaceId=${workspaceId}`),
        fetch(`${apiUrl}/workspace/members?workspaceId=${workspaceId}`),
        fetch(`${apiUrl}/mcp-api-keys?workspaceId=${workspaceId}`),
      ]);
      if (!wsRes.ok) throw new Error(`Workspace load failed: HTTP ${wsRes.status}`);
      const wsBody = await wsRes.json() as { data: WorkspaceData };
      setWorkspace(wsBody.data);
      if (membersRes.ok) {
        const body = await membersRes.json() as { data: TeamMember[] };
        setMembers(body.data);
      }
      if (keysRes.ok) {
        const body = await keysRes.json() as { data: ApiKey[] };
        setApiKeys(body.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSaveName(name: string) {
    const res = await fetch(`${apiUrl}/workspace/settings?workspaceId=${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Save failed: HTTP ${res.status}`);
    const body = await res.json() as { data: WorkspaceData };
    setWorkspace(body.data);
  }

  async function handleInvite(email: string, role: string) {
    const res = await fetch(`${apiUrl}/workspace/members?workspaceId=${workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) throw new Error(`Invite failed: HTTP ${res.status}`);
    void load();
  }

  async function handleRevokeMember(memberId: string) {
    const res = await fetch(`${apiUrl}/workspace/members/${memberId}?workspaceId=${workspaceId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Revoke failed: HTTP ${res.status}`);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  async function handleCreateApiKey(name: string, scopes: string[]) {
    const res = await fetch(`${apiUrl}/mcp-api-keys?workspaceId=${workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes }),
    });
    if (!res.ok) throw new Error(`Create key failed: HTTP ${res.status}`);
    const body = await res.json() as { data: ApiKey & { key: string } };
    setApiKeys((prev) => [body.data, ...prev]);
    return { key: body.data.key };
  }

  async function handleRevokeApiKey(keyId: string) {
    const res = await fetch(`${apiUrl}/mcp-api-keys/${keyId}?workspaceId=${workspaceId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Revoke failed: HTTP ${res.status}`);
    setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <Link href="/" className="mb-3 block text-sm text-gray-500 hover:text-gray-700">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Workspace Settings</h1>
        <p className="mt-1 text-sm text-gray-500 font-mono">{workspaceId}</p>
      </header>

      <div className="flex gap-0 border-b border-gray-200 mb-8">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>
      )}

      {!loading && !error && workspace && (
        <>
          {activeTab === 'info' && (
            <section>
              <WorkspaceInfo workspace={workspace} onSave={handleSaveName} />
            </section>
          )}

          {activeTab === 'team' && (
            <section className="space-y-8">
              <TeamMemberList members={members} onRevoke={handleRevokeMember} />
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Invite a member</h3>
                <TeamInviteForm onInvite={handleInvite} />
              </div>
            </section>
          )}

          {activeTab === 'apikeys' && (
            <section>
              <ApiKeyManager
                apiKeys={apiKeys}
                onCreate={handleCreateApiKey}
                onRevoke={handleRevokeApiKey}
              />
            </section>
          )}

          {activeTab === 'billing' && (
            <section>
              <BillingCard
                plan={workspace.plan}
                entityCount={workspace.entityCount ?? 0}
                queryCount={workspace.queryCount ?? 0}
                entityLimit={workspace.entityLimit ?? 10_000}
                queryLimit={workspace.queryLimit ?? 50_000}
                onUpgrade={() => { window.open('https://iris.ai/upgrade', '_blank'); }}
              />
            </section>
          )}

          {activeTab === 'privacy' && (
            <section className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="text-base font-semibold mb-1">Export Data</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Download all indexed entities and metadata in OSI format.
                </p>
                <a
                  href={`/api/v1/export/osi?workspaceId=${workspaceId}`}
                  className="inline-flex px-4 py-2 bg-gray-100 text-sm text-gray-700 rounded hover:bg-gray-200"
                >
                  Download OSI export
                </a>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="text-base font-semibold mb-1">PII Configuration</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Configure field-level masking for sensitive data.
                </p>
                <Link
                  href="/connectors"
                  className="inline-flex px-4 py-2 bg-gray-100 text-sm text-gray-700 rounded hover:bg-gray-200"
                >
                  Go to PII config →
                </Link>
              </div>

              <div className="rounded-lg border border-red-100 bg-red-50 p-6">
                <h3 className="text-base font-semibold text-red-700 mb-1">Delete Workspace</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Permanently delete this workspace and all its data. This cannot be undone.
                </p>
                <button
                  className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                  onClick={() => {
                    if (window.confirm('Delete workspace permanently?')) {
                      alert('Delete workspace — contact support to proceed.');
                    }
                  }}
                >
                  Delete workspace
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
