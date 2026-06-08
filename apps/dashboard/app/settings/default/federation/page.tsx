'use client';

import { useState } from 'react';

type RelationshipType = 'parent_child' | 'sibling' | 'partner';
type Tab = 'relationships' | 'audit';

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  parent_child: 'Parent / Child',
  sibling: 'Sibling',
  partner: 'Partner',
};

const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  parent_child: 'bg-blue-100 text-blue-800',
  sibling: 'bg-purple-100 text-purple-800',
  partner: 'bg-green-100 text-green-800',
};

type FederatedRelationship = {
  id: string;
  targetWorkspaceId: string;
  relationshipType: RelationshipType;
  permissions: Array<{ entityTypePattern: string; canRead: boolean; canWrite: boolean }>;
  trustedAt: string;
};

type AuditEntry = {
  queryId: string;
  queriedWorkspaces: string[];
  entityCount: number;
  timestamp: string;
};

const MOCK_RELATIONSHIPS: FederatedRelationship[] = [
  {
    id: 'r1',
    targetWorkspaceId: 'acme-corp',
    relationshipType: 'parent_child',
    permissions: [{ entityTypePattern: '*', canRead: true, canWrite: false }],
    trustedAt: '2026-06-01T00:00:00Z',
  },
  {
    id: 'r2',
    targetWorkspaceId: 'partner-agency',
    relationshipType: 'partner',
    permissions: [
      { entityTypePattern: 'contact', canRead: true, canWrite: false },
      { entityTypePattern: 'deal', canRead: true, canWrite: false },
    ],
    trustedAt: '2026-06-05T00:00:00Z',
  },
];

const MOCK_AUDIT: AuditEntry[] = [
  { queryId: 'q1', queriedWorkspaces: ['acme-corp'], entityCount: 12, timestamp: '2026-06-08T10:23:00Z' },
  { queryId: 'q2', queriedWorkspaces: ['acme-corp', 'partner-agency'], entityCount: 7, timestamp: '2026-06-08T09:45:00Z' },
  { queryId: 'q3', queriedWorkspaces: ['partner-agency'], entityCount: 3, timestamp: '2026-06-07T16:12:00Z' },
];

export default function FederationPage() {
  const [tab, setTab] = useState<Tab>('relationships');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTargetId, setNewTargetId] = useState('');
  const [newRelType, setNewRelType] = useState<RelationshipType>('sibling');
  const [expandedRel, setExpandedRel] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Workspace Federation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Connect sibling, parent, and partner workspaces to share context securely.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Add Federation
        </button>
      </div>

      {showAddForm && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">New Federated Relationship</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700">Target Workspace ID</label>
              <input
                value={newTargetId}
                onChange={e => setNewTargetId(e.target.value)}
                placeholder="e.g. acme-corp-prod"
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Relationship Type</label>
              <select
                value={newRelType}
                onChange={e => setNewRelType(e.target.value as RelationshipType)}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {(Object.entries(RELATIONSHIP_LABELS) as [RelationshipType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => { setShowAddForm(false); setNewTargetId(''); }}
              className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              disabled={!newTargetId.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Establish Federation
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
        {(['relationships', 'audit'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t === 'relationships' ? 'Relationships' : 'Access Audit'}
          </button>
        ))}
      </div>

      {tab === 'relationships' && (
        <div className="space-y-3">
          {MOCK_RELATIONSHIPS.map(rel => (
            <div key={rel.id} className="rounded-lg border border-gray-200 bg-white">
              <div
                className="flex cursor-pointer items-center justify-between p-4"
                onClick={() => setExpandedRel(expandedRel === rel.id ? null : rel.id)}
              >
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RELATIONSHIP_COLORS[rel.relationshipType]}`}>
                    {RELATIONSHIP_LABELS[rel.relationshipType]}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{rel.targetWorkspaceId}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>Trusted {new Date(rel.trustedAt).toLocaleDateString()}</span>
                  <span>{expandedRel === rel.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedRel === rel.id && (
                <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                  <h4 className="mb-2 text-xs font-semibold text-gray-600">Permissions</h4>
                  <div className="space-y-1">
                    {rel.permissions.map(p => (
                      <div key={p.entityTypePattern} className="flex items-center gap-3 text-xs">
                        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">{p.entityTypePattern}</code>
                        <span className={p.canRead ? 'text-green-600' : 'text-gray-400'}>read</span>
                        <span className={p.canWrite ? 'text-green-600' : 'text-gray-400'}>write</span>
                      </div>
                    ))}
                  </div>
                  <button className="mt-3 text-xs font-medium text-red-600 hover:text-red-700">
                    Revoke Federation
                  </button>
                </div>
              )}
            </div>
          ))}
          {MOCK_RELATIONSHIPS.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
              No federated relationships. Add one above to enable cross-workspace context sharing.
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Query ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Queried Workspaces</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Entities</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_AUDIT.map(a => (
                <tr key={a.queryId} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{a.queryId}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {a.queriedWorkspaces.map(ws => (
                        <span key={ws} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{ws}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{a.entityCount}</td>
                  <td className="px-4 py-2.5 text-gray-500">{new Date(a.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
