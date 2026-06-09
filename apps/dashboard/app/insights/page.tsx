'use client';

import { useState, useEffect } from 'react';

type InsightType = 'anomaly' | 'trend' | 'outlier' | 'missing_data' | 'relationship' | 'pattern';
type InsightSeverity = 'info' | 'warning' | 'critical';

type Insight = {
  id: string;
  entityType: string;
  insightType: InsightType;
  title: string;
  summary: string;
  affectedCount: number;
  severity: InsightSeverity;
  valueScore: number;
  evidence: string[];
  detectedAt: string;
};

const SEVERITY_STYLES: Record<InsightSeverity, string> = {
  critical: 'bg-red-950 border-red-800 text-red-300',
  warning: 'bg-yellow-950 border-yellow-800 text-yellow-300',
  info: 'bg-blue-950 border-blue-800 text-blue-300',
};

const TYPE_LABELS: Record<InsightType, string> = {
  anomaly: 'Anomaly', trend: 'Trend', outlier: 'Outlier',
  missing_data: 'Missing Data', relationship: 'Relationship', pattern: 'Pattern',
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<InsightSeverity | ''>('');
  const [typeFilter, setTypeFilter] = useState<InsightType | ''>('');
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadInsights();
  }, [severityFilter, typeFilter]);

  async function loadInsights() {
    setLoading(true);
    const params = new URLSearchParams({ limit: '20' });
    if (severityFilter) params.set('severity', severityFilter);
    if (typeFilter) params.set('type', typeFilter);
    try {
      const res = await fetch(`/api/v1/insights?${params}`, { headers: { 'x-workspace-id': WORKSPACE_ID } });
      if (res.ok) {
        const body = await res.json() as { data: Insight[] };
        setInsights(body.data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(id: string, valuable: boolean) {
    await fetch(`/api/v1/insights/${id}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
      body: JSON.stringify({ wasValuable: valuable }),
    });
    setFeedbackSent((prev) => new Set([...prev, id]));
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Business Insights</h1>
        <p className="text-sm text-gray-400 mt-1">Automatically generated insights from your indexed data — patterns, anomalies, and data quality issues.</p>
      </header>

      <div className="flex gap-3 mb-6">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as InsightSeverity | '')}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as InsightType | '')}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="">All types</option>
          {(Object.keys(TYPE_LABELS) as InsightType[]).map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-3">
          {loading && <div className="text-gray-500 text-sm text-center py-8">Loading insights...</div>}
          {!loading && insights.length === 0 && (
            <div className="text-center py-12 text-gray-500 text-sm">No insights found. Run a discovery scan to generate insights.</div>
          )}
          {insights.map((insight) => (
            <div
              key={insight.id}
              onClick={() => setSelectedInsight(selectedInsight?.id === insight.id ? null : insight)}
              className={`border rounded-lg p-4 cursor-pointer transition-colors ${selectedInsight?.id === insight.id ? 'border-blue-500' : SEVERITY_STYLES[insight.severity]}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${SEVERITY_STYLES[insight.severity]}`}>
                      {insight.severity}
                    </span>
                    <span className="text-xs text-gray-500">{TYPE_LABELS[insight.insightType]}</span>
                    <span className="text-xs text-gray-600">·</span>
                    <span className="text-xs text-gray-500 capitalize">{insight.entityType}</span>
                  </div>
                  <p className="text-sm font-medium text-white">{insight.title}</p>
                  <p className="text-xs text-gray-400 mt-1">{insight.summary}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-semibold text-white">{insight.affectedCount}</div>
                  <div className="text-xs text-gray-500">affected</div>
                  <div className="text-xs text-gray-600 mt-1">score: {insight.valueScore}</div>
                </div>
              </div>
              {!feedbackSent.has(insight.id) && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-800">
                  <span className="text-xs text-gray-500">Helpful?</span>
                  <button onClick={(e) => { e.stopPropagation(); void sendFeedback(insight.id, true); }} className="text-xs text-green-400 hover:text-green-300">Yes</button>
                  <button onClick={(e) => { e.stopPropagation(); void sendFeedback(insight.id, false); }} className="text-xs text-red-400 hover:text-red-300">No</button>
                </div>
              )}
              {feedbackSent.has(insight.id) && (
                <div className="mt-2 text-xs text-gray-500">Feedback recorded.</div>
              )}
            </div>
          ))}
        </div>

        <div className="col-span-4">
          {selectedInsight ? (
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 sticky top-6">
              <h2 className="font-semibold text-white mb-2">{selectedInsight.title}</h2>
              <p className="text-sm text-gray-300 mb-4">{selectedInsight.summary}</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="text-gray-200">{TYPE_LABELS[selectedInsight.insightType]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Entity Type</span>
                  <span className="text-gray-200 capitalize">{selectedInsight.entityType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Affected</span>
                  <span className="text-gray-200">{selectedInsight.affectedCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Value Score</span>
                  <span className="text-gray-200">{selectedInsight.valueScore}</span>
                </div>
              </div>
              {selectedInsight.evidence.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Evidence</div>
                  <ul className="space-y-1">
                    {selectedInsight.evidence.map((e) => (
                      <li key={e} className="text-xs text-gray-400 flex items-start gap-1">
                        <span className="text-gray-600 mt-0.5">·</span>
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 text-center text-sm text-gray-500">
              Click an insight to see details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
