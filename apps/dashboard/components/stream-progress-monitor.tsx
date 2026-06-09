'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

type StreamProgress = {
  chunksReceived: number;
  bytesReceived: number;
  tokensReceived: number;
  entitiesReceived: number;
  isComplete: boolean;
  hasError: boolean;
  errorMessage?: string;
  startedAt?: number;
  elapsedMs?: number;
};

type Props = {
  streamUrl: string;
  contextBudget?: number;
  onChunk?: (entities: unknown[]) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
};

function ProgressBar({ value, max, color = 'bg-blue-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-300 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-800">{value}</p>
    </div>
  );
}

export function StreamProgressMonitor({
  streamUrl,
  contextBudget = 2000,
  onChunk,
  onComplete,
  onError,
}: Props) {
  const [progress, setProgress] = useState<StreamProgress>({
    chunksReceived: 0,
    bytesReceived: 0,
    tokensReceived: 0,
    entitiesReceived: 0,
    isComplete: false,
    hasError: false,
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async () => {
    if (isStreaming) return;
    abortRef.current = new AbortController();
    setIsStreaming(true);
    setProgress({
      chunksReceived: 0, bytesReceived: 0, tokensReceived: 0, entitiesReceived: 0,
      isComplete: false, hasError: false, startedAt: performance.now(),
    });

    try {
      const res = await fetch(streamUrl, { signal: abortRef.current.signal });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.trim()) continue;
          const data = part.replace(/^data:\s*/, '');
          if (data === '[DONE]') {
            setProgress((p) => ({
              ...p,
              isComplete: true,
              elapsedMs: p.startedAt ? Math.round(performance.now() - p.startedAt) : undefined,
            }));
            onComplete?.();
            setIsStreaming(false);
            return;
          }
          try {
            const chunk = JSON.parse(data) as {
              metadata: { tokensInChunk: number };
              entities: unknown[];
              error?: string;
            };
            if (chunk.error) {
              setProgress((p) => ({ ...p, hasError: true, errorMessage: chunk.error }));
              onError?.(chunk.error ?? 'Stream error');
              continue;
            }
            const bytes = new TextEncoder().encode(data).length;
            setProgress((p) => ({
              ...p,
              chunksReceived: p.chunksReceived + 1,
              bytesReceived: p.bytesReceived + bytes,
              tokensReceived: p.tokensReceived + (chunk.metadata?.tokensInChunk ?? 0),
              entitiesReceived: p.entitiesReceived + (chunk.entities?.length ?? 0),
              elapsedMs: p.startedAt ? Math.round(performance.now() - p.startedAt) : undefined,
            }));
            onChunk?.(chunk.entities ?? []);
          } catch {
            // malformed chunk — skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'Stream failed';
        setProgress((p) => ({ ...p, hasError: true, errorMessage: msg }));
        onError?.(msg);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, streamUrl, onChunk, onComplete, onError]);

  function cancelStream() {
    abortRef.current?.abort();
    setIsStreaming(false);
    setProgress((p) => ({ ...p, isComplete: false }));
  }

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const tokenPct = contextBudget > 0 ? Math.min(100, Math.round((progress.tokensReceived / contextBudget) * 100)) : 0;
  const elapsed = progress.elapsedMs != null ? `${(progress.elapsedMs / 1000).toFixed(1)}s` : '—';

  return (
    <div className="p-4 border border-gray-200 rounded-xl bg-white space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Stream Progress</h3>
        <div className="flex gap-2">
          {!isStreaming && !progress.isComplete && (
            <button
              type="button"
              onClick={() => void startStream()}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Start
            </button>
          )}
          {isStreaming && (
            <button
              type="button"
              onClick={cancelStream}
              className="text-xs px-3 py-1.5 bg-red-100 text-red-700 border border-red-200 rounded-lg hover:bg-red-200 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {progress.hasError && (
        <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
          Error: {progress.errorMessage ?? 'Unknown error'}
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Token budget</span>
          <span>{progress.tokensReceived.toLocaleString()} / {contextBudget.toLocaleString()} ({tokenPct}%)</span>
        </div>
        <ProgressBar
          value={progress.tokensReceived}
          max={contextBudget}
          color={tokenPct > 80 ? 'bg-orange-400' : 'bg-blue-500'}
        />
      </div>

      <div className="grid grid-cols-4 gap-2 pt-1">
        <StatChip label="Chunks" value={progress.chunksReceived} />
        <StatChip label="Entities" value={progress.entitiesReceived.toLocaleString()} />
        <StatChip label="Bytes" value={progress.bytesReceived > 1024 ? `${(progress.bytesReceived / 1024).toFixed(1)}KB` : `${progress.bytesReceived}B`} />
        <StatChip label="Elapsed" value={elapsed} />
      </div>

      {progress.isComplete && (
        <div className="text-center text-xs text-green-600 font-medium pt-1">
          Stream complete — {progress.entitiesReceived} entities received
        </div>
      )}
      {isStreaming && (
        <div className="flex items-center gap-2 text-xs text-blue-600">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          Streaming…
        </div>
      )}
    </div>
  );
}
