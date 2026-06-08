'use client';

import { useState, useEffect } from 'react';
import { PeerComparisonCharts } from '../../../../../components/peer-comparison-charts';
import { BenchmarkInsightsPanel } from '../../../../../components/benchmark-insights-panel';

type BenchmarkSettings = {
  benchmarkingEnabled: boolean;
  industry: string | null;
  companySize: string | null;
};

type PeerComparison = {
  metric: string;
  workspaceValue: number;
  peerPercentiles: { p25: number; p50: number; p75: number; p90: number };
  percentileRank: number;
};

type BenchmarkReport = {
  peerComparisons: PeerComparison[];
  peerCount: number;
};

type Insight = {
  metricType: string;
  currentRank: number;
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
};

const INDUSTRIES = ['software', 'finance', 'healthcare', 'retail', 'manufacturing', 'professional-services', 'other'];
const SIZES = ['startup', 'smb', 'midmarket', 'enterprise'];

function generateInsights(comparisons: PeerComparison[]): Insight[] {
  return comparisons
    .filter((c) => c.percentileRank < 50)
    .slice(0, 4)
    .map((c) => ({
      metricType: c.metric,
      currentRank: c.percentileRank,
      recommendation: getRecommendation(c.metric, c.percentileRank),
      priority: c.percentileRank < 25 ? 'high' : c.percentileRank < 40 ? 'medium' : 'low',
    }));
}

function getRecommendation(metric: string, rank: number): string {
  const rankDesc = rank < 25 ? 'well below average' : 'below average';
  const recs: Record<string, string> = {
    cache_hit_rate: `Cache hit rate is ${rankDesc}. Consider increasing semantic similarity threshold or warming the cache with common queries.`,
    token_savings_ratio: `Token savings are ${rankDesc}. Enable compression pipeline and review context budget settings.`,
    entity_count: `Entity coverage is ${rankDesc}. Connect more data sources or lower sync thresholds to index more entities.`,
  };
  return recs[metric] ?? `${metric.replace(/_/g, ' ')} is ${rankDesc} — review your configuration.`;
}

type Props = {
  params: { workspaceId: string };
};

export default function BenchmarksPage({ params }: Props) {
  const { workspaceId } = params;
  const [settings, setSettings] = useState<BenchmarkSettings | null>(null);
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [industry, setIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');

  useEffect(() => {
    fetch(`/api/v1/benchmarks/opt-in`, { headers: { 'x-workspace-id': workspaceId } })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json() as { data: BenchmarkSettings };
        setSettings(json.data);
        setIndustry(json.data.industry ?? '');
        setCompanySize(json.data.companySize ?? '');
        if (json.data.benchmarkingEnabled) {
          return fetch(`/api/v1/benchmarks/peers`, { headers: { 'x-workspace-id': workspaceId } });
        }
      })
      .then(async (r) => {
        if (!r?.ok) return;
        const json = await r.json() as { data: BenchmarkReport };
        setReport(json.data);
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  async function handleOptIn() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/benchmarks/opt-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ industry, companySize }),
      });
      if (!res.ok) throw new Error('Opt-in failed');
      const json = await res.json() as { data: BenchmarkSettings };
      setSettings(json.data);
    } finally {
      setSaving(false);
    }
  }

  async function handleOptOut() {
    setSaving(true);
    try {
      await fetch(`/api/v1/benchmarks/opt-out`, { method: 'POST', headers: { 'x-workspace-id': workspaceId } });
      setSettings((s) => s ? { ...s, benchmarkingEnabled: false } : null);
      setReport(null);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 24, color: '#6b7280' }}>Loading benchmarks…</div>;

  const benchmarkEntries = (report?.peerComparisons ?? []).map((c) => ({
    metricType: c.metric,
    yourValue: c.workspaceValue,
    percentileRank: c.percentileRank,
    peerPercentiles: c.peerPercentiles,
  }));
  const insights = generateInsights(report?.peerComparisons ?? []);

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Peer Benchmarks</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Compare your Iris usage patterns against anonymized peers in your industry. All data is hashed and aggregated — no individual workspace data is ever shared.
      </p>

      {!settings?.benchmarkingEnabled ? (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, maxWidth: 500 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Enable Peer Benchmarking</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            Opt in to see how your metrics compare to similar companies. Your workspace ID is permanently anonymized via SHA-256. You can opt out at any time.
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Industry</label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
            >
              <option value="">Select industry</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i.replace(/-/g, ' ')}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Company size</label>
            <select
              value={companySize}
              onChange={(e) => setCompanySize(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
            >
              <option value="">Select size</option>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button
            onClick={() => void handleOptIn()}
            disabled={saving || !industry || !companySize}
            style={{
              padding: '8px 20px', background: saving || !industry || !companySize ? '#e5e7eb' : '#6366f1',
              color: saving || !industry || !companySize ? '#9ca3af' : '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
            }}
          >
            {saving ? 'Enabling…' : 'Enable Benchmarking'}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 24, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#15803d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Benchmarking enabled · {report?.peerCount ?? 0} peer workspaces in cohort · {settings.industry} / {settings.companySize}</span>
            <button onClick={() => void handleOptOut()} disabled={saving} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12, textDecoration: 'underline' }}>
              Opt out
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Peer Comparison</h2>
              <PeerComparisonCharts benchmarks={benchmarkEntries} />
            </div>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Optimization Insights</h2>
              <BenchmarkInsightsPanel insights={insights} onOptOut={() => void handleOptOut()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
