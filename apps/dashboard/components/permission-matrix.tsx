'use client';

import React, { useState } from 'react';

export type FieldPermEntry = {
  entityType: string;
  fieldName: string;
  permissionType: 'view' | 'edit' | 'delete';
  roleIds: string[];
};

type Props = {
  permissions: FieldPermEntry[];
  roles: string[];
  entityTypes: string[];
  onToggle?: (entityType: string, fieldName: string, permType: 'view' | 'edit' | 'delete', roleId: string, allow: boolean) => void;
};

type CellKey = `${string}:${string}:${'view' | 'edit' | 'delete'}`;

function makeKey(entityType: string, fieldName: string, permType: 'view' | 'edit' | 'delete'): CellKey {
  return `${entityType}:${fieldName}:${permType}`;
}

export function PermissionMatrix({ permissions, roles, entityTypes, onToggle }: Props) {
  const [filter, setFilter] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');

  const permMap = new Map<CellKey, Set<string>>();
  for (const p of permissions) {
    const key = makeKey(p.entityType, p.fieldName, p.permissionType);
    const existing = permMap.get(key) ?? new Set<string>();
    p.roleIds.forEach((r) => existing.add(r));
    permMap.set(key, existing);
  }

  const permTypes = ['view', 'edit', 'delete'] as const;

  const filteredRows = permissions
    .filter((p) => selectedType === 'all' || p.entityType === selectedType)
    .filter((p) => !filter || p.fieldName.includes(filter) || p.entityType.includes(filter));

  const uniqueFields = Array.from(new Set(filteredRows.map((p) => `${p.entityType}:${p.fieldName}`)));

  if (roles.length === 0 || permissions.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 border border-dashed rounded-lg">
        No permissions configured. Define field permissions to populate this matrix.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Filter by field or entity…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none"
        >
          <option value="all">All entity types</option>
          {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="overflow-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b sticky top-0">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600 w-32">Entity.Field</th>
              {roles.flatMap((role) =>
                permTypes.map((pt) => (
                  <th key={`${role}:${pt}`} className="px-2 py-2 text-center font-medium text-gray-600 min-w-[60px]">
                    <div className="text-xs text-gray-500">{role}</div>
                    <div className="text-xs text-gray-400">{pt}</div>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {uniqueFields.map((fieldKey) => {
              const [entityType, fieldName] = fieldKey.split(':') as [string, string];
              return (
                <tr key={fieldKey} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-gray-700">
                    <span className="text-gray-400">{entityType}.</span>{fieldName}
                  </td>
                  {roles.flatMap((role) =>
                    permTypes.map((pt) => {
                      const key = makeKey(entityType, fieldName, pt);
                      const allowed = permMap.get(key)?.has(role) ?? false;
                      return (
                        <td key={`${role}:${pt}`} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => onToggle?.(entityType, fieldName, pt, role, !allowed)}
                            className={`w-6 h-6 rounded border text-xs font-bold transition-colors ${allowed ? 'bg-green-100 border-green-400 text-green-700 hover:bg-green-200' : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'}`}
                          >
                            {allowed ? '✓' : '×'}
                          </button>
                        </td>
                      );
                    }),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Green = role can perform that action. Click to toggle. Changes are saved immediately.
      </p>
    </div>
  );
}
