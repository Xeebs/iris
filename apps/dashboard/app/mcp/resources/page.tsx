'use client';

import React, { useState, useEffect } from 'react';

interface ResourceDescriptor {
  name: string;
  uriTemplate: string;
  description: string;
  mimeType: string;
  examples: string[];
}

interface URIBuilderState {
  type: string;
  entityId: string;
}

export default function McpResourcesPage() {
  const workspaceId = 'default';
  const [resources, setResources] = useState<ResourceDescriptor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [builder, setBuilder] = useState<URIBuilderState>({ type: 'entity', entityId: '' });
  const [builtUri, setBuiltUri] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/mcp/resources?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => r.json())
      .then((j) => setResources(j.data ?? []))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [workspaceId]);

  const buildUri = async () => {
    if (!builder.entityId) return;
    const params = new URLSearchParams({
      type: builder.type,
      workspaceId,
      entityId: builder.entityId,
    });
    const res = await fetch(`/api/v1/mcp/resources/uri?${params.toString()}`);
    const json = await res.json();
    setBuiltUri(json.data?.uri ?? null);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-2">MCP Resources</h1>
      <p className="text-sm text-gray-600 mb-8">
        Resources expose structured data (entities, graphs, documents) that Claude and other MCP
        clients can read directly via URI.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading resources…</p>
      ) : (
        <div className="space-y-6">
          {resources.map((r) => (
            <div key={r.name} className="border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-medium">{r.name}</h2>
                  <p className="text-sm text-gray-600 mt-1">{r.description}</p>
                </div>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded shrink-0">{r.mimeType}</span>
              </div>
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-1">URI Template</p>
                <code className="text-xs bg-gray-50 px-2 py-1 rounded block">{r.uriTemplate}</code>
              </div>
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-1">Examples</p>
                {r.examples.map((ex) => (
                  <code key={ex} className="text-xs bg-blue-50 text-blue-800 px-2 py-0.5 rounded block mb-1">{ex}</code>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 border-t pt-6">
        <h2 className="text-lg font-medium mb-4">URI Builder</h2>
        <div className="flex gap-3 flex-wrap">
          <select
            value={builder.type}
            onChange={(e) => setBuilder((b) => ({ ...b, type: e.target.value }))}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="entity">Entity</option>
            <option value="entity-graph">Entity Graph</option>
            <option value="document">Document</option>
          </select>
          <input
            type="text"
            placeholder="Entity ID (e.g. hubspot:contact:1234)"
            value={builder.entityId}
            onChange={(e) => setBuilder((b) => ({ ...b, entityId: e.target.value }))}
            className="border rounded px-2 py-1 text-sm flex-1 min-w-48"
          />
          <button
            onClick={buildUri}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm"
          >
            Build URI
          </button>
        </div>
        {builtUri && (
          <div className="mt-3">
            <p className="text-xs text-gray-500 mb-1">Generated URI</p>
            <code className="text-sm bg-green-50 text-green-800 px-3 py-2 rounded block break-all">{builtUri}</code>
          </div>
        )}
      </div>
    </div>
  );
}
