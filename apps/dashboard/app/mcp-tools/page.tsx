'use client';

import { useEffect, useState } from 'react';

type ToolSchema = {
  name: string;
  description: string;
  inputFields: { name: string; type: string; required: boolean; description?: string }[];
  examples: { description: string; input: Record<string, unknown> }[];
};

export default function McpToolsPage() {
  const [tools, setTools] = useState<ToolSchema[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ToolSchema | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = search ? `/api/v1/mcp/tools?search=${encodeURIComponent(search)}` : '/api/v1/mcp/tools';
    fetch(url)
      .then((r) => r.json())
      .then((j) => setTools(j.data ?? []))
      .finally(() => setLoading(false));
  }, [search]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">MCP Tool Catalog</h1>
        <p className="text-sm text-zinc-400 mt-1">Browse available MCP tools, their schemas, and usage examples.</p>
      </div>

      <input
        type="search"
        placeholder="Search tools…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
      />

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1 space-y-2">
          {loading && <div className="text-zinc-500 text-sm">Loading…</div>}
          {tools.map((t) => (
            <button
              key={t.name}
              onClick={() => setSelected(t)}
              className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${selected?.name === t.name ? 'border-blue-500/50 bg-blue-500/10' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700/50'}`}
            >
              <div className="text-sm font-mono font-medium text-white">{t.name}</div>
              <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{t.description}</div>
            </button>
          ))}
          {!loading && tools.length === 0 && (
            <div className="text-zinc-500 text-sm">No tools match your search.</div>
          )}
        </div>

        <div className="col-span-2">
          {selected ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 space-y-6">
              <div>
                <h2 className="text-xl font-mono font-bold text-white">{selected.name}</h2>
                <p className="text-sm text-zinc-400 mt-1">{selected.description}</p>
              </div>

              <div>
                <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Input Schema</h3>
                <div className="space-y-2">
                  {selected.inputFields.map((f) => (
                    <div key={f.name} className="flex items-start gap-3 text-sm">
                      <span className="font-mono text-blue-400 flex-shrink-0">{f.name}</span>
                      <span className="text-xs text-zinc-500 pt-0.5">{f.type}</span>
                      {f.required && <span className="text-xs text-red-400 pt-0.5">required</span>}
                      {f.description && <span className="text-xs text-zinc-600">{f.description}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {selected.examples.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Examples</h3>
                  <div className="space-y-3">
                    {selected.examples.map((ex, i) => (
                      <div key={i} className="rounded border border-zinc-700 overflow-hidden">
                        <div className="px-3 py-2 bg-zinc-700/50 text-xs text-zinc-400">{ex.description}</div>
                        <pre className="px-3 py-3 text-xs text-zinc-300 overflow-x-auto">
                          {JSON.stringify(ex.input, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-12 text-center text-zinc-500 text-sm">
              Select a tool to view its schema and examples.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
