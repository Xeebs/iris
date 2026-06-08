'use client';

import { useState, useEffect, useCallback } from 'react';
import { SloScorecard } from '../../../components/slo-scorecard';

type SloStatus = 'ok' | 'warning' | 'breached';

type SloAttainment = {
  sloName: string;
  metric: string;
  target: number;
  attainmentPct: number;
  totalEvents: number;
  metEvents: number;
  windowHours: number;
  status: SloStatus;
};

type SloViolation = {
  id: number;
  sloName: string;
  attainmentPct: number;
  targetPct: number;
  severity: 'warning' | 'critical';
  correctiveHint: string | null;
  startedAt: string;
  resolvedAt: string | null;
};

export default function SlosPage() {
  const [attainments, setAttainments] = useState<SloAttainment[]>([]);
  const [violations, setViolations] = useState<SloViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'dashboard' | 'violations'>('dashboard');

  const workspaceId = 'default';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [attRes, violRes] = await Promise.all([
        fetch('/api/v1/admin/slos', { headers: { 'x-workspace-id': workspaceId } }),
        fetch('/api/v1/admin/slos/violations', { headers: { 'x-workspace-id': workspaceId } }),
      ]);
      const attBody = await attRes.json() as { data?: SloAttainment[] };
      const violBody = await violRes.json() as { data?: SloViolation[] };
      if (attBody.data) setAttainments(attBody.data);
      if (violBody.data) setViolations(violBody.data);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const breached = attainments.filter((a) => a.status === 'breached');
  const atRisk = attainments.filter((a) => a.status === 'warning');
  const healthy = attainments.filter((a) => a.status === 'ok');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Service Level Objectives</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor SLO attainment and track violations.</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Summary strip */}
      {!loading && attainments.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="border rounded-lg p-4 bg-green-50 border-green-200 text-center">
            <div className="text-2xl font-bold text-green-700">{healthy.length}</div>
            <div className="text-xs text-green-600 mt-1">Healthy SLOs</div>
          </div>
          <div className="border rounded-lg p-4 bg-yellow-50 border-yellow-200 text-center">
            <div className="text-2xl font-bold text-yellow-700">{atRisk.length}</div>
            <div className="text-xs text-yellow-600 mt-1">At risk</div>
          </div>
          <div className="border rounded-lg p-4 bg-red-50 border-red-200 text-center">
            <div className="text-2xl font-bold text-red-700">{breached.length}</div>
            <div className="text-xs text-red-600 mt-1">Breached</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['dashboard', 'violations'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'dashboard' ? 'SLO Dashboard' : `Violations (${violations.length})`}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div>
          {loading ? (
            <p className="text-sm text-gray-400">Loading SLOs…</p>
          ) : attainments.length === 0 ? (
            <div className="border rounded-lg p-8 text-center text-gray-400">
              <p className="text-sm">No SLOs defined yet.</p>
              <p className="text-xs mt-1">POST to /api/v1/admin/slos to define SLOs, or enable built-in SLOs.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Show breached first, then at-risk, then ok */}
              {[...breached, ...atRisk, ...healthy].map((slo) => (
                <SloScorecard key={slo.sloName} slo={slo} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'violations' && (
        <div>
          {violations.length === 0 ? (
            <p className="text-sm text-gray-500">No violations recorded.</p>
          ) : (
            <div className="space-y-2">
              {violations.map((v) => (
                <div
                  key={v.id}
                  className={`border rounded-lg p-4 ${v.severity === 'critical' ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{v.sloName}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {v.severity}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Attainment: <span className="font-medium">{v.attainmentPct.toFixed(1)}%</span> (target: {v.targetPct.toFixed(1)}%)
                    · {new Date(v.startedAt).toLocaleString()}
                    {v.resolvedAt && ` → ${new Date(v.resolvedAt).toLocaleString()}`}
                  </div>
                  {v.correctiveHint && (
                    <div className="text-xs text-gray-600 mt-1.5 italic">💡 {v.correctiveHint}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
