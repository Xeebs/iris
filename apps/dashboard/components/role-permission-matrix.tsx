'use client';

type Permission = { permissionName: string; grantedAt: string; grantedBy: string };

type Props = {
  roleId: string;
  permissions: Permission[];
  onRevoke: (permissionName: string) => void;
};

const ACTION_ORDER = ['read', 'write', 'admin', 'delete'];
const RESOURCE_ORDER = ['entities', 'connectors', 'queries', 'metrics', 'workspaces', 'users'];

function hasPermission(permissions: Permission[], action: string, resource: string): Permission | undefined {
  return permissions.find((p) => p.permissionName === `${action}:${resource}`);
}

export function RolePermissionMatrix({ roleId, permissions, onRevoke }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left px-4 py-2 text-zinc-400 font-medium w-36">Resource</th>
            {ACTION_ORDER.map((action) => (
              <th key={action} className="text-center px-4 py-2 text-zinc-400 font-medium capitalize">
                {action}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RESOURCE_ORDER.map((resource) => (
            <tr key={resource} className="border-t border-zinc-800">
              <td className="px-4 py-3 text-zinc-300 font-medium capitalize">{resource}</td>
              {ACTION_ORDER.map((action) => {
                const perm = hasPermission(permissions, action, resource);
                return (
                  <td key={action} className="px-4 py-3 text-center">
                    {perm ? (
                      <button
                        onClick={() => onRevoke(perm.permissionName)}
                        title={`Granted by ${perm.grantedBy}`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400 transition-colors group"
                      >
                        <svg className="w-4 h-4 group-hover:hidden" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <svg className="w-4 h-4 hidden group-hover:block" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    ) : (
                      <span className="inline-block w-7 h-7 rounded-full border border-zinc-700" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-zinc-600 px-4">Click a granted permission (green) to revoke it.</p>
    </div>
  );
}
