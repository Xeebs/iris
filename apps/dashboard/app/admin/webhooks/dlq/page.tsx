'use client';

import { useEffect, useState } from 'react';
import { DlqEventTable } from '../../../../components/dlq-event-table.js';
import { DlqPatternAnalysis } from '../../../../components/dlq-pattern-analysis.js';

type DlqEvent = {
  id: string;
  endpoint: string;
  eventType: string;
  finalError: string;
  failedAt: string;
  replayedAt: string | null;
};

type DlqPattern = {
  pattern: string;
  count: number;
  affectedEndpoints: string[];
  suggestion: string;
};

export default function WebhookDlqPage() {
  const [events, setEvents] = useState<DlqEvent[]>([]);
  const [patterns, setPatterns] = useState<DlqPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [evRes, patRes] = await Promise.all([
      fetch('/api/v1/admin/webhooks/dlq'),
      fetch('/api/v1/admin/webhooks/dlq/analyze'),
    ]);
    if (evRes.ok) {
      const json = await evRes.json();
      setEvents(json.data ?? []);
    }
    if (patRes.ok) {
      const json = await patRes.json();
      setPatterns(json.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  async function handleReplay(id: string) {
    setError(null);
    const res = await fetch(`/api/v1/admin/webhooks/dlq/${id}/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ replayedBy: 'dashboard' }),
    });
    if (!res.ok) {
      const json = await res.json();
      setError(json.error?.message ?? 'Replay failed');
    } else {
      await refresh();
    }
  }

  async function prune() {
    setPruning(true);
    setError(null);
    const res = await fetch('/api/v1/admin/webhooks/dlq/prune', { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error?.message ?? 'Prune failed');
    } else {
      await refresh();
    }
    setPruning(false);
  }

  const unresolved = events.filter((e) => !e.replayedAt).length;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Webhook Dead-Letter Queue</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {loading ? 'Loading…' : `${unresolved} unresolved event${unresolved !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={prune}
          disabled={pruning}
          className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 rounded"
        >
          {pruning ? 'Pruning…' : 'Prune old events'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-sm text-red-400">{error}</div>
      )}

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Pattern Analysis</h2>
        {loading ? <div className="text-zinc-500 text-sm">Loading…</div> : <DlqPatternAnalysis patterns={patterns} />}
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Failed Events</h2>
        {loading ? <div className="text-zinc-500 text-sm">Loading…</div> : (
          <DlqEventTable events={events} onReplay={handleReplay} />
        )}
      </section>
    </div>
  );
}
