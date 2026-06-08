'use client';

import { useState } from 'react';

type RegionConfig = {
  regionId: string;
  role: 'primary' | 'replica';
};

export function FailoverControlPanel({
  primaryRegion,
  replicas,
  onFailover,
}: {
  primaryRegion: RegionConfig | null;
  replicas: { regionId: string; status: string; lagMs: number | null }[];
  onFailover: (toRegion: string) => Promise<void>;
}) {
  const [targetRegion, setTargetRegion] = useState('');
  const [confirmedBy, setConfirmedBy] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function executeFailover() {
    if (!targetRegion || !confirmedBy) return;
    setExecuting(true);
    try {
      await onFailover(targetRegion);
      setResult({ ok: true, message: `Failover to ${targetRegion} recorded.` });
    } catch {
      setResult({ ok: false, message: 'Failover failed. Check logs.' });
    } finally {
      setExecuting(false);
      setShowModal(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-zinc-200">Manual Failover</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Current primary: <span className="text-zinc-300">{primaryRegion?.regionId ?? 'none'}</span>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={replicas.length === 0}
          className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded"
        >
          Initiate failover
        </button>
      </div>

      {result && (
        <div className={`text-sm px-3 py-2 rounded ${result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {result.message}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Confirm Failover</h3>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Promote to region</label>
              <select
                value={targetRegion}
                onChange={(e) => setTargetRegion(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-white"
              >
                <option value="">Select target region…</option>
                {replicas.map((r) => (
                  <option key={r.regionId} value={r.regionId}>
                    {r.regionId} ({r.status}{r.lagMs !== null ? `, lag: ${r.lagMs}ms` : ''})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Authorized by</label>
              <input
                value={confirmedBy}
                onChange={(e) => setConfirmedBy(e.target.value)}
                placeholder="Your name / user ID"
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-xs text-red-300">
              This will mark {targetRegion || 'the selected region'} as primary and log the event. Actual DNS/routing changes must be applied separately.
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={executeFailover}
                disabled={!targetRegion || !confirmedBy || executing}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded"
              >
                {executing ? 'Executing…' : 'Confirm failover'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
