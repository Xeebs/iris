'use client';

import React from 'react';

export type ConnectorAccess = {
  connectorId: string;
  connectorName: string;
  allowedRoles: string[];
};

type Props = {
  connectors: ConnectorAccess[];
  roles: string[];
  onChange?: (connectorId: string, roleId: string, allowed: boolean) => void;
};

export function ConnectorAccessSelector({ connectors, roles, onChange }: Props) {
  if (connectors.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 border border-dashed rounded-lg">
        No connectors configured.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Connector</th>
              {roles.map((role) => (
                <th key={role} className="px-4 py-2 text-center font-medium text-gray-600">{role}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {connectors.map((connector) => (
              <tr key={connector.connectorId} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <span className="font-medium text-gray-800">{connector.connectorName}</span>
                  <span className="text-xs text-gray-400 ml-1">({connector.connectorId})</span>
                </td>
                {roles.map((role) => {
                  const allowed = connector.allowedRoles.includes(role);
                  return (
                    <td key={role} className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={allowed}
                        onChange={(e) => onChange?.(connector.connectorId, role, e.target.checked)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Unchecked roles cannot access data from that connector in MCP queries or the dashboard.
        Changes take effect immediately.
      </p>
    </div>
  );
}
