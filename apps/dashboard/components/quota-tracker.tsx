'use client';

import { useState } from 'react';

type IncreaseRequest = {
  id: string;
  workspaceId: string;
  requestedTier: string;
  justification: string;
  status: string;
  createdAt: string;
};

type Props = {
  workspaceId: string;
  currentTier: string;
  requests: IncreaseRequest[];
  onSubmitRequest: (requestedTier: 'pro' | 'enterprise', justification: string) => Promise<void>;
};

export function QuotaTracker({ workspaceId, currentTier, requests, onSubmitRequest }: Props) {
  const [requestedTier, setRequestedTier] = useState<'pro' | 'enterprise'>('pro');
  const [justification, setJustification] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (justification.length < 10) return;
    setLoading(true);
    try {
      await onSubmitRequest(requestedTier, justification);
      setSubmitted(true);
      setJustification('');
    } finally {
      setLoading(false);
    }
  }

  const canUpgrade = currentTier !== 'enterprise';

  return (
    <div className="space-y-6">
      {/* Current tier */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Current Plan</p>
        <p className="text-2xl font-bold text-white capitalize">{currentTier}</p>
      </div>

      {/* Pending requests */}
      {requests.length > 0 && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-700">
            <span className="text-sm font-medium text-zinc-300">Quota Increase Requests</span>
          </div>
          <div className="divide-y divide-zinc-800">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  r.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400' :
                  r.status === 'approved' ? 'bg-green-500/10 text-green-400' :
                  'bg-red-500/10 text-red-400'
                }`}>
                  {r.status}
                </span>
                <span className="text-zinc-300 capitalize">{r.requestedTier}</span>
                <span className="text-zinc-500 text-xs ml-auto">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request upgrade form */}
      {canUpgrade && !submitted && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
          <h3 className="text-sm font-medium text-zinc-300 mb-4">Request Quota Increase</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Target Plan</label>
              <div className="flex gap-2">
                {(['pro', 'enterprise'] as const).filter((t) => t > currentTier).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRequestedTier(t)}
                    className={`px-4 py-2 rounded text-sm capitalize transition-colors ${requestedTier === t ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Justification</label>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Describe your use case and why you need higher limits…"
                rows={3}
                className="w-full bg-zinc-700 border border-zinc-600 rounded px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
              />
              {justification.length > 0 && justification.length < 10 && (
                <p className="text-xs text-red-400">Please provide at least 10 characters.</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || justification.length < 10}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm py-2 rounded transition-colors"
            >
              {loading ? 'Submitting…' : 'Submit Request'}
            </button>
          </form>
        </div>
      )}

      {submitted && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          Your quota increase request has been submitted. Our team will review it shortly.
        </div>
      )}

      {!canUpgrade && (
        <p className="text-sm text-zinc-500 text-center">You are on the highest available plan.</p>
      )}
    </div>
  );
}
