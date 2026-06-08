'use client';

import { useEffect, useState } from 'react';
import { RolePermissionMatrix } from '../../../components/role-permission-matrix';
import { PermissionInheritanceTree } from '../../../components/permission-inheritance-tree';
import { BulkPermissionEditor } from '../../../components/bulk-permission-editor';

type RolePermission = { permissionName: string; grantedAt: string; grantedBy: string };
type Template = { name: string; permissions: string[] };
type AuditEntry = { id: string; permissionName: string; action: string; actor: string; occurredAt: string };

const EXAMPLE_ROLES = ['role-viewer', 'role-analyst', 'role-connector-admin', 'role-admin'];

export default function PermissionsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>(EXAMPLE_ROLES[0]!);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'matrix' | 'audit' | 'bulk'>('matrix');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/v1/permissions/templates')
      .then((r) => r.json())
      .then((j) => setTemplates(j.data ?? []));
  }, []);

  useEffect(() => {
    if (!selectedRole) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/v1/permissions/roles/${selectedRole}`).then((r) => r.json()),
      fetch(`/api/v1/permissions/roles/${selectedRole}/audit`).then((r) => r.json()),
    ]).then(([permsRes, auditRes]) => {
      setRolePermissions(permsRes.data ?? []);
      setAudit(auditRes.data ?? []);
    }).finally(() => setLoading(false));
  }, [selectedRole]);

  async function handleRevoke(permissionName: string) {
    await fetch(`/api/v1/permissions/roles/${selectedRole}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permissionName, actor: 'dashboard-user' }),
    });
    setRolePermissions((prev) => prev.filter((p) => p.permissionName !== permissionName));
  }

  async function handleApplyTemplate(templateName: string) {
    await fetch(`/api/v1/permissions/roles/${selectedRole}/apply-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateName, actor: 'dashboard-user' }),
    });
    const res = await fetch(`/api/v1/permissions/roles/${selectedRole}`).then((r) => r.json());
    setRolePermissions(res.data ?? []);
  }

  async function handleBulkApply(roleIds: string[], permissionName: string, action: 'grant' | 'revoke') {
    await Promise.all(
      roleIds.map((roleId) =>
        fetch(`/api/v1/permissions/roles/${roleId}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ permissionName, actor: 'dashboard-user' }),
        }),
      ),
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Permission Management</h1>
        <p className="text-sm text-zinc-400 mt-1">Manage role permissions, apply templates, and audit access changes.</p>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Left: template tree + role list */}
        <div className="col-span-1 space-y-6">
          <PermissionInheritanceTree
            templates={templates}
            onSelect={handleApplyTemplate}
          />

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Roles</h3>
            {EXAMPLE_ROLES.map((roleId) => (
              <button
                key={roleId}
                onClick={() => setSelectedRole(roleId)}
                className={`w-full text-left rounded px-3 py-2 text-sm transition-colors ${
                  selectedRole === roleId
                    ? 'bg-blue-500/10 border border-blue-500/50 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {roleId}
              </button>
            ))}
          </div>
        </div>

        {/* Right: tabs */}
        <div className="col-span-3 space-y-4">
          <div className="flex gap-1 rounded-lg bg-zinc-800 p-1 w-fit">
            {(['matrix', 'audit', 'bulk'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded text-sm capitalize transition-colors ${
                  activeTab === tab ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tab === 'bulk' ? 'Bulk Edit' : tab === 'matrix' ? 'Permission Matrix' : 'Audit Trail'}
              </button>
            ))}
          </div>

          {loading && <div className="text-zinc-500 text-sm">Loading…</div>}

          {!loading && activeTab === 'matrix' && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700">
                <span className="text-sm font-medium text-zinc-300">{selectedRole}</span>
                <span className="ml-2 text-xs text-zinc-500">({rolePermissions.length} permissions)</span>
              </div>
              <RolePermissionMatrix
                roleId={selectedRole}
                permissions={rolePermissions}
                onRevoke={handleRevoke}
              />
            </div>
          )}

          {!loading && activeTab === 'audit' && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700">
                <span className="text-sm font-medium text-zinc-300">Audit Trail — {selectedRole}</span>
              </div>
              <div className="divide-y divide-zinc-800">
                {audit.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-4 px-4 py-3 text-sm">
                    <span className={`w-14 text-center text-xs font-medium px-2 py-0.5 rounded-full ${entry.action === 'granted' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                      {entry.action}
                    </span>
                    <span className="font-mono text-xs text-zinc-300">{entry.permissionName}</span>
                    <span className="text-zinc-500 text-xs ml-auto">by {entry.actor}</span>
                    <span className="text-zinc-600 text-xs">{new Date(entry.occurredAt).toLocaleDateString()}</span>
                  </div>
                ))}
                {audit.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">No audit entries.</p>}
              </div>
            </div>
          )}

          {!loading && activeTab === 'bulk' && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 max-w-md">
              <BulkPermissionEditor
                roleIds={EXAMPLE_ROLES}
                onApply={handleBulkApply}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
