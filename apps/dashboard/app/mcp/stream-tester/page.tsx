'use client';

import { useState, useRef } from 'react';

type StreamChunkMetadata = {
  chunkIndex: number;
  moreChunks: boolean;
  totalCount: number;
  tokensInChunk: number;
};

type StreamChunk = {
  metadata: StreamChunkMetadata;
  entities: { id: string; type: string; label: string }[];
};

type StreamEvent = { type: 'chunk'; data: StreamChunk } | { type: 'done' } | { type: 'error'; message: string };

const SAMPLE_ENTITIES = JSON.stringify(
  [
    {
      id: 'hubspot:contact:1',
      type: 'contact',
      label: 'Alice Smith',
      attributes: { email: 'alice@example.com', stage: 'customer', company: 'Acme Corp' },
      relationships: [{ type: 'belongs_to', targetId: 'hubspot:company:10' }],
      lastModified: new Date().toISOString(),
      sourceId: 'hubspot:contact:1',
    },
    {
      id: 'hubspot:contact:2',
      type: 'contact',
      label: 'Bob Jones',
      attributes: { email: 'bob@example.com', stage: 'lead', company: 'Widget Inc' },
      relationships: [],
      lastModified: new Date().toISOString(),
      sourceId: 'hubspot:contact:2',
    },
    {
      id: 'hubspot:deal:1',
      type: 'deal',
      label: 'Q3 Renewal',
      attributes: { amount: 12000, stage: 'proposal', closeDate: '2026-09-30' },
      relationships: [{ type: 'owned_by', targetId: 'hubspot:contact:1' }],
      lastModified: new Date().toISOString(),
      sourceId: 'hubspot:deal:1',
    },
  ],
  null,
  2,
);

export default function StreamTesterPage() {
  const [entitiesJson, setEntitiesJson] = useState(SAMPLE_ENTITIES);
  const [maxTokens, setMaxTokens] = useState(1500);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function validateJson(value: string) {
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch {
      setJsonError('Invalid JSON');
    }
  }

  async function startStream() {
    setJsonError(null);
    let entities: unknown;
    try {
      entities = JSON.parse(entitiesJson);
    } catch {
      setJsonError('Invalid JSON — cannot start stream');
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEvents([]);
    setStreaming(true);

    try {
      const res = await fetch('/api/v1/mcp/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entities, maxTokensPerChunk: maxTokens }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setEvents([{ type: 'error', message: body?.error?.message ?? `HTTP ${res.status}` }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice('data: '.length).trim();
          if (raw === '[DONE]') {
            setEvents((prev) => [...prev, { type: 'done' }]);
          } else {
            try {
              const chunk = JSON.parse(raw) as StreamChunk;
              setEvents((prev) => [...prev, { type: 'chunk', data: chunk }]);
            } catch {
              // malformed event — skip
            }
          }
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') {
        setEvents((prev) => [...prev, { type: 'error', message: String(e) }]);
      }
    } finally {
      setStreaming(false);
    }
  }

  function stopStream() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  const chunkEvents = events.filter((e): e is { type: 'chunk'; data: StreamChunk } => e.type === 'chunk');
  const isDone = events.some((e) => e.type === 'done');
  const errorEvent = events.find((e): e is { type: 'error'; message: string } => e.type === 'error');

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">MCP Stream Tester</h1>
        <p className="text-sm text-gray-500 mt-1">
          Test the SSE streaming endpoint by sending entities and watching chunks arrive in real time.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config panel */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Entities JSON
            </label>
            <textarea
              className={`w-full h-72 font-mono text-xs p-3 border rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                jsonError ? 'border-red-400' : 'border-gray-300'
              }`}
              value={entitiesJson}
              onChange={(e) => {
                setEntitiesJson(e.target.value);
                validateJson(e.target.value);
              }}
              spellCheck={false}
            />
            {jsonError && <p className="text-xs text-red-500 mt-1">{jsonError}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Max tokens per chunk: <span className="font-mono">{maxTokens}</span>
            </label>
            <input
              type="range"
              min={100}
              max={8000}
              step={100}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>100</span>
              <span>8000</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={startStream}
              disabled={streaming || !!jsonError}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {streaming ? 'Streaming…' : 'Start Stream'}
            </button>
            {streaming && (
              <button
                onClick={stopStream}
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
              >
                Stop
              </button>
            )}
            {events.length > 0 && !streaming && (
              <button
                onClick={() => setEvents([])}
                className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded hover:bg-gray-200"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Results panel */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Stream events</span>
            {chunkEvents.length > 0 && (
              <span className="text-xs text-gray-500">
                {chunkEvents.length} chunk{chunkEvents.length !== 1 ? 's' : ''}
                {isDone ? ' · done' : ''}
              </span>
            )}
          </div>

          <div className="border border-gray-200 rounded h-72 overflow-y-auto p-3 space-y-2 bg-gray-50 font-mono text-xs">
            {events.length === 0 && (
              <p className="text-gray-400 text-center pt-8">No events yet. Click Start Stream.</p>
            )}

            {events.map((event, i) => {
              if (event.type === 'error') {
                return (
                  <div key={i} className="bg-red-50 border border-red-200 rounded p-2 text-red-700">
                    Error: {event.message}
                  </div>
                );
              }
              if (event.type === 'done') {
                return (
                  <div key={i} className="text-green-600 font-medium">
                    ✓ [DONE]
                  </div>
                );
              }
              const { metadata, entities } = event.data;
              return (
                <div key={i} className="bg-white border border-gray-200 rounded p-2 space-y-1">
                  <div className="flex items-center justify-between text-gray-500">
                    <span>
                      Chunk {metadata.chunkIndex} · {metadata.tokensInChunk} tokens
                    </span>
                    <span className={metadata.moreChunks ? 'text-amber-500' : 'text-green-600'}>
                      {metadata.moreChunks ? 'more…' : 'last'}
                    </span>
                  </div>
                  <div>
                    {entities.map((e) => (
                      <span key={e.id} className="inline-block mr-2 text-gray-700">
                        [{e.type}] {e.label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {chunkEvents.length > 0 && (
        <div>
          <h2 className="text-sm font-medium mb-2">Raw chunk data</h2>
          <pre className="bg-gray-900 text-green-400 text-xs rounded p-4 overflow-x-auto max-h-64 overflow-y-auto">
            {chunkEvents.map((e, i) => `// Chunk ${i}\n${JSON.stringify(e.data, null, 2)}`).join('\n\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
