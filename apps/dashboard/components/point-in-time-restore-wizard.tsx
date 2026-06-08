'use client';

import { useState } from 'react';

type RestorePlan = {
  targetTimestamp: string;
  chain: { id: string; backupType: string; completedAt: string | null }[];
  estimatedRtoMinutes: number;
  status: string;
};

export function PointInTimeRestoreWizard({
  backupId,
  onClose,
}: {
  backupId: string;
  onClose: () => void;
}) {
  const [targetTimestamp, setTargetTimestamp] = useState('');
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function loadPlan() {
    if (!targetTimestamp) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/backups/${backupId}/restore-to-point`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetTimestamp: new Date(targetTimestamp).toISOString() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? 'Failed to load restore plan');
      } else {
        setPlan(json.data);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Point-in-Time Restore</h2>

        {!plan && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Restore to timestamp</label>
              <input
                type="datetime-local"
                value={targetTimestamp}
                onChange={(e) => setTargetTimestamp(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-white"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
              <button
                onClick={loadPlan}
                disabled={!targetTimestamp || loading}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded"
              >
                {loading ? 'Loading…' : 'Plan restore'}
              </button>
            </div>
          </div>
        )}

        {plan && !confirmed && (
          <div className="space-y-4">
            <div className="bg-zinc-800 rounded-lg p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-400">Target time</span>
                <span className="text-white">{new Date(plan.targetTimestamp).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Backup chain</span>
                <span className="text-white">{plan.chain.length} backup(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Estimated RTO</span>
                <span className="text-yellow-400">{plan.estimatedRtoMinutes} min</span>
              </div>
            </div>
            <div className="text-xs text-zinc-500">Chain: {plan.chain.map((c) => `${c.backupType}(${c.id.slice(0, 6)})`).join(' → ')}</div>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-xs text-yellow-300">
              This will replace current entity data with the restore point snapshot. This action cannot be undone.
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPlan(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Back</button>
              <button
                onClick={() => setConfirmed(true)}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded"
              >
                Confirm restore
              </button>
            </div>
          </div>
        )}

        {confirmed && (
          <div className="text-center space-y-4">
            <div className="text-green-400 text-sm">Restore plan confirmed. Contact your admin to execute the restore from the chain listed above.</div>
            <button onClick={onClose} className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
