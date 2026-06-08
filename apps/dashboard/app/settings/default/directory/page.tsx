'use client';

import { useState } from 'react';
import { SCIMSyncStatus } from '../../../../components/scim-sync-status.js';

const DEFAULT_WORKSPACE = 'default';

type Tab = 'overview' | 'users' | 'groups' | 'config';

type ScimUser = {
  id: string;
  userName: string;
  displayName?: string;
  active: boolean;
  emails?: Array<{ value: string }>;
};

export default function DirectoryPage() {
  const workspaceId = DEFAULT_WORKSPACE;
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<ScimUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [endpointToken, setEndpointToken] = useState('');
  const [copied, setCopied] = useState(false);

  const SCIM_BASE = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/scim/v2`;

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const res = await fetch(`/api/v1/scim/v2/Users?count=50`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (res.ok) {
        const data = await res.json() as { Resources: ScimUser[] };
        setUsers(data.Resources ?? []);
      }
    } finally {
      setLoadingUsers(false);
    }
  }

  function copyEndpoint(url: string) {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Provisioned Users' },
    { id: 'groups', label: 'Group Mappings' },
    { id: 'config', label: 'Configuration' },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Directory Integration</h1>
        <p className="text-sm text-gray-500 mt-1">
          SCIM 2.0 provisioning for Azure AD, Okta, and Google Workspace.
        </p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); if (tab.id === 'users') void loadUsers(); }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Sync Status</h2>
            <SCIMSyncStatus workspaceId={workspaceId} />
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{users.length} provisioned users</p>
            <button onClick={loadUsers} className="text-sm text-blue-600 hover:text-blue-800">Refresh</button>
          </div>
          {loadingUsers ? (
            <div className="animate-pulse bg-gray-100 rounded-lg h-40" />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {['User', 'Email', 'Status', 'ID'].map(h => (
                      <th key={h} className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{u.displayName ?? u.userName}</td>
                      <td className="px-4 py-2 text-gray-500">{u.emails?.[0]?.value ?? u.userName}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {u.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-400">{u.id}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No users provisioned yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'groups' && (
        <div className="bg-white border rounded-lg p-6 space-y-3">
          <h2 className="text-lg font-semibold text-gray-800">Role Mappings</h2>
          <p className="text-sm text-gray-500">Directory groups are automatically mapped to Iris roles based on group name keywords.</p>
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Group Name Contains</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Iris Role</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                { keyword: 'admin', role: 'admin', color: 'bg-red-100 text-red-700' },
                { keyword: 'editor, write', role: 'editor', color: 'bg-blue-100 text-blue-700' },
                { keyword: 'viewer, read (default)', role: 'viewer', color: 'bg-gray-100 text-gray-700' },
              ].map(r => (
                <tr key={r.role}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.keyword}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.color}`}>{r.role}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">SCIM Endpoint Configuration</h2>
            <p className="text-sm text-gray-500">
              Configure your identity provider with these endpoints and an API key.
            </p>
            <div className="space-y-3">
              {[
                { label: 'Base URL', value: SCIM_BASE },
                { label: 'Users Endpoint', value: `${SCIM_BASE}/Users` },
                { label: 'Groups Endpoint', value: `${SCIM_BASE}/Groups` },
              ].map(item => (
                <div key={item.label}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{item.label}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={item.value}
                      className="flex-1 border rounded px-3 py-1.5 text-sm font-mono text-gray-700 bg-gray-50"
                    />
                    <button
                      onClick={() => copyEndpoint(item.value)}
                      className="px-3 py-1.5 text-xs border rounded text-gray-600 hover:bg-gray-50"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bearer Token</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={endpointToken}
                  onChange={e => setEndpointToken(e.target.value)}
                  placeholder="Generate a new SCIM token..."
                  className="flex-1 border rounded px-3 py-1.5 text-sm"
                />
                <button className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium">
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
