'use client';

import { useState } from 'react';

type ProviderEstimate = {
  providerId: string;
  providerName: string;
  modelId: string;
  costPer1mTokens: number;
};

type CostProjectionCalculatorProps = {
  providers: ProviderEstimate[];
};

const MONTHLY_QUERY_PRESETS = [
  { label: '10K', value: 10_000 },
  { label: '100K', value: 100_000 },
  { label: '1M', value: 1_000_000 },
  { label: '10M', value: 10_000_000 },
];

/**
 * Compares monthly token cost projections across configured LLM providers.
 * Helps users choose the most cost-effective provider for their usage.
 */
export function CostProjectionCalculator({ providers }: CostProjectionCalculatorProps) {
  const [monthlyTokens, setMonthlyTokens] = useState(1_000_000);

  if (providers.length === 0) {
    return (
      <div style={{ padding: 20, border: '1px solid #e5e7eb', borderRadius: 10, color: '#9ca3af', fontSize: 14, textAlign: 'center' }}>
        Add at least one provider to see cost projections.
      </div>
    );
  }

  const estimates = providers
    .map(p => ({
      ...p,
      monthlyCostUsd: (monthlyTokens / 1_000_000) * p.costPer1mTokens,
    }))
    .sort((a, b) => a.monthlyCostUsd - b.monthlyCostUsd);

  const cheapest = estimates[0]!;
  const maxCost = estimates[estimates.length - 1]!.monthlyCostUsd;

  const formatCost = (usd: number) => usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
  const formatTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1000).toFixed(0)}K`;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Monthly Cost Projection</h4>

      {/* Token volume selector */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Monthly token volume</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {MONTHLY_QUERY_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => setMonthlyTokens(p.value)}
              style={{
                padding: '4px 12px', borderRadius: 16,
                border: `1px solid ${monthlyTokens === p.value ? '#2563eb' : '#d1d5db'}`,
                background: monthlyTokens === p.value ? '#eff6ff' : '#fff',
                color: monthlyTokens === p.value ? '#1d4ed8' : '#374151',
                fontSize: 12, cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={10_000}
          max={50_000_000}
          step={10_000}
          value={monthlyTokens}
          onChange={e => setMonthlyTokens(Number(e.target.value))}
          style={{ width: '100%' }}
        />
        <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
          {formatTokens(monthlyTokens)} tokens / month
        </div>
      </div>

      {/* Comparison bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {estimates.map((e, i) => (
          <div key={e.providerId}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>
                <strong>{e.providerName}</strong>
                <span style={{ color: '#9ca3af', marginLeft: 6, fontSize: 11 }}>{e.modelId}</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? '#16a34a' : '#374151' }}>
                {formatCost(e.monthlyCostUsd)}/mo
                {i === 0 && <span style={{ marginLeft: 6, color: '#16a34a', fontSize: 11 }}>cheapest</span>}
              </span>
            </div>
            <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: maxCost > 0 ? `${(e.monthlyCostUsd / maxCost) * 100}%` : '0%',
                  background: i === 0 ? '#16a34a' : '#2563eb',
                  borderRadius: 4,
                  minWidth: e.monthlyCostUsd > 0 ? 4 : 0,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {estimates.length > 1 && (
        <div style={{ marginTop: 14, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, fontSize: 12, color: '#166534' }}>
          Using <strong>{cheapest.providerName}</strong> saves{' '}
          <strong>{formatCost(estimates[estimates.length - 1]!.monthlyCostUsd - cheapest.monthlyCostUsd)}</strong> vs. most expensive option at {formatTokens(monthlyTokens)} tokens/month.
        </div>
      )}
    </div>
  );
}
