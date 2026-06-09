'use client';

import React, { useMemo } from 'react';

export type DependencyNode = {
  queryHash: string;
  queryText: string | null;
  entityIds: string[];
};

type Props = {
  nodes: DependencyNode[];
};

function generateMermaid(nodes: DependencyNode[]): string {
  const lines: string[] = ['flowchart LR'];
  const entitySet = new Set<string>();

  for (const node of nodes) {
    const qId = `Q_${node.queryHash.slice(0, 8)}`;
    const qLabel = (node.queryText ?? node.queryHash.slice(0, 16)).replace(/"/g, "'");
    lines.push(`  ${qId}["🔍 ${qLabel}"]`);

    for (const entityId of node.entityIds) {
      const parts = entityId.split(':');
      const shortId = parts.at(-1) ?? entityId;
      const eId = `E_${shortId.replace(/[^a-zA-Z0-9]/g, '_')}`;
      if (!entitySet.has(eId)) {
        const eLabel = entityId.replace(/"/g, "'");
        lines.push(`  ${eId}["📦 ${eLabel}"]`);
        entitySet.add(eId);
      }
      lines.push(`  ${qId} --> ${eId}`);
    }
  }

  return lines.join('\n');
}

export function DependencyGraph({ nodes }: Props) {
  const mermaidCode = useMemo(() => generateMermaid(nodes), [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 border border-dashed rounded-lg">
        No dependency data available.
      </div>
    );
  }

  const totalEdges = nodes.reduce((s, n) => s + n.entityIds.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Query → Entity Dependencies</h3>
        <span className="text-xs text-gray-400">
          {nodes.length} queries · {totalEdges} dependency edges
        </span>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 border-b px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">Mermaid Diagram</span>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(mermaidCode)}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            Copy diagram
          </button>
        </div>
        <pre className="p-4 text-xs overflow-auto max-h-96 bg-white font-mono leading-relaxed">
          {mermaidCode}
        </pre>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Query</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Depends on</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Edges</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {nodes.map((node) => (
              <tr key={node.queryHash} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-gray-700 max-w-xs truncate">
                  {node.queryText ?? node.queryHash}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {node.entityIds.slice(0, 5).map((e) => (
                      <span
                        key={e}
                        className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs truncate max-w-[120px]"
                        title={e}
                      >
                        {e.split(':').at(-1) ?? e}
                      </span>
                    ))}
                    {node.entityIds.length > 5 && (
                      <span className="text-gray-400">+{node.entityIds.length - 5} more</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-right text-gray-500">{node.entityIds.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
