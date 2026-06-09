'use client';

export type DependencyNode = {
  connectorId: string;
  version: string;
  dependencies: DependencyNode[];
  hasConflict: boolean;
};

type NodeProps = {
  node: DependencyNode;
  depth: number;
};

function DependencyNodeRow({ node, depth }: NodeProps) {
  const indent = depth * 20;
  return (
    <>
      <div
        className={`flex items-center gap-2 py-1.5 px-3 rounded text-sm ${node.hasConflict ? 'bg-red-950 border border-red-800' : 'bg-gray-800 border border-gray-700'}`}
        style={{ marginLeft: indent }}
      >
        <span className={`font-medium ${node.hasConflict ? 'text-red-300' : 'text-gray-100'}`}>{node.connectorId}</span>
        <span className="text-xs text-gray-500">@{node.version}</span>
        {node.hasConflict && (
          <span className="ml-auto text-xs text-red-400 font-medium">version conflict</span>
        )}
        {depth === 0 && !node.hasConflict && (
          <span className="ml-auto text-xs text-blue-400">root</span>
        )}
      </div>
      {node.dependencies.map((dep) => (
        <DependencyNodeRow key={`${dep.connectorId}@${dep.version}`} node={dep} depth={depth + 1} />
      ))}
    </>
  );
}

type Props = {
  root: DependencyNode;
};

/**
 * Renders a dependency tree for a connector version.
 * Highlights version conflicts in red.
 */
export function DependencyGraphViewer({ root }: Props) {
  const hasConflicts = rootHasAnyConflict(root);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-200">Dependency Tree</h3>
        {hasConflicts && (
          <span className="text-xs text-red-400 bg-red-950 border border-red-800 rounded px-2 py-0.5">
            Conflicts detected
          </span>
        )}
        {!hasConflicts && (
          <span className="text-xs text-green-400 bg-green-950 border border-green-800 rounded px-2 py-0.5">
            No conflicts
          </span>
        )}
      </div>
      {root.dependencies.length === 0 && !hasConflicts ? (
        <div className="space-y-2">
          <DependencyNodeRow node={root} depth={0} />
          <p className="text-xs text-gray-500 mt-2 text-center">No dependencies</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <DependencyNodeRow node={root} depth={0} />
        </div>
      )}
    </div>
  );
}

function rootHasAnyConflict(node: DependencyNode): boolean {
  if (node.hasConflict) return true;
  return node.dependencies.some(rootHasAnyConflict);
}
