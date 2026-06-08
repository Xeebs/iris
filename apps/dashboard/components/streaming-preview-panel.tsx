'use client';

import { useState, useRef, useCallback } from 'react';

interface ParsedChunk {
  event: string;
  data: Record<string, unknown>;
}

export default function StreamingPreviewPanel() {
  const [query, setQuery] = useState('');
  const [tokenBudget, setTokenBudget] = useState(2000);
  const [chunks, setChunks] = useState<ParsedChunk[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async () => {
    if (!query.trim()) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setChunks([]);
    setError(null);
    setStreaming(true);

    try {
      const res = await fetch('/api/v1/context/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), tokenBudget }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(trimmed.slice(6)) as ParsedChunk;
            setChunks((prev) => [...prev, chunk]);
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e.message);
      }
    } finally {
      setStreaming(false);
    }
  }, [query, tokenBudget]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const entityChunks = chunks.filter((c) => c.event === 'entity');
  const doneChunk = chunks.find((c) => c.event === 'done');
  const metaChunk = chunks.find((c) => c.event === 'meta');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter a query to preview streaming…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={(e) => { if (e.key === 'Enter' && !streaming) void startStream(); }}
        />
        <input
          type="number"
          value={tokenBudget}
          onChange={(e) => setTokenBudget(Number(e.target.value))}
          min={100}
          max={16000}
          className="w-24 rounded-md border border-gray-300 px-2 py-2 text-sm"
          title="Token budget"
        />
        {streaming ? (
          <button
            onClick={cancel}
            className="px-3 py-2 text-sm rounded-md bg-red-100 text-red-700 hover:bg-red-200"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => void startStream()}
            disabled={!query.trim()}
            className="px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Stream
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {metaChunk && (
        <div className="text-xs text-gray-500">
          Budget: {String(metaChunk.data['totalEstimatedTokens'])} tokens &mdash; Started:{' '}
          {String(metaChunk.data['startedAt'])}
        </div>
      )}

      <div className="max-h-64 overflow-y-auto space-y-2">
        {entityChunks.map((c, i) => (
          <div key={i} className="flex items-start gap-3 text-sm border border-gray-100 rounded-md p-2">
            <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium
              ${c.data['confidenceTier'] === 'high' ? 'bg-green-100 text-green-700' :
                c.data['confidenceTier'] === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-600'}`}>
              {String(c.data['confidenceTier'])}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800 truncate">{String(c.data['label'])}</p>
              <p className="text-gray-500 text-xs">
                {String(c.data['type'])} &middot; {String(c.data['tokenEstimate'])} tokens &middot; score{' '}
                {(c.data['relevanceScore'] as number).toFixed(3)}
              </p>
            </div>
          </div>
        ))}

        {entityChunks.length === 0 && streaming && (
          <p className="text-sm text-gray-400 animate-pulse">Streaming…</p>
        )}
      </div>

      {doneChunk && (
        <div className="text-xs text-gray-500 border-t pt-2">
          {String(doneChunk.data['totalEntities'])} entities &mdash;{' '}
          {String(doneChunk.data['totalTokensUsed'])} tokens &mdash;{' '}
          {String(doneChunk.data['durationMs'])} ms
          {doneChunk.data['truncated'] && (
            <span className="ml-2 text-amber-600 font-medium">Truncated</span>
          )}
        </div>
      )}
    </div>
  );
}
