'use client';

import { useState, useEffect, useCallback } from 'react';

type TierName = 'free' | 'pro' | 'enterprise';

type TierLimits = {
  requestsPerMinute: number;
  requestsPerDay: number;
  mcpCallsPerHour: number;
};

type QuotaStatus = {
  workspaceId: string;
  tier: TierName;
  requestsThisMinute: number;
  requestsToday: number;
  mcpCallsThisHour: number;
  limits: TierLimits;
  rateLimited: boolean;
  retryAfterMs: number | null;
};

const TIER_COLORS: Record<TierName, string> = {
  free: '#6b7280',
  pro: '#2563eb',
  enterprise: '#7c3aed',
};

const TIER_DESCRIPTIONS: Record<TierName, string> = {
  free: 'For individuals and small projects.',
  pro: 'For growing teams with higher usage needs.',
  enterprise: 'Unlimited capacity for large organizations.',
};

function UsageBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = Math.min(100, (current / max) * 100);
  const color = pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#16a34a';
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#374151' }}>{label}</span>
        <span style={{ color: '#6b7280' }}>{current.toLocaleString()} / {max.toLocaleString()}</span>
      </div>
      <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

/**
 * Usage and quota limits page for workspace settings.
 */
export default function UsageLimitsPage() {
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [tierLimits, setTierLimits] = useState<Record<TierName, TierLimits> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeRequested, setUpgradeRequested] = useState(false);

  const API_BASE = '/api/v1';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usageRes, limitsRes] = await Promise.all([
        fetch(`${API_BASE}/usage`),
        fetch(`${API_BASE}/limits`),
      ]);
      const usageJson = await usageRes.json() as { data?: QuotaStatus };
      const limitsJson = await limitsRes.json() as { data?: Record<TierName, TierLimits> };
      setQuota(usageJson.data ?? null);
      setTierLimits(limitsJson.data ?? null);
    } catch {
      setError('Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const requestUpgrade = async () => {
    await fetch(`${API_BASE}/limits/increase-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Requesting tier upgrade from dashboard' }),
    });
    setUpgradeRequested(true);
  };

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 800 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Usage & Limits</h1>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
          Monitor your API usage and manage quota limits.
        </p>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && <div style={{ color: '#9ca3af' }}>Loading usage data…</div>}

      {quota && (
        <>
          {/* Rate limited banner */}
          {quota.rateLimited && (
            <div style={{ padding: 12, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
              <strong style={{ color: '#92400e' }}>Rate limited.</strong>
              <span style={{ color: '#92400e', marginLeft: 4 }}>
                Retry in {Math.ceil((quota.retryAfterMs ?? 0) / 1000)}s. Consider upgrading your plan.
              </span>
            </div>
          )}

          {/* Current tier badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ padding: '4px 14px', background: TIER_COLORS[quota.tier], color: '#fff', borderRadius: 20, fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>
              {quota.tier}
            </span>
            <span style={{ color: '#6b7280', fontSize: 13 }}>{TIER_DESCRIPTIONS[quota.tier]}</span>
          </div>

          {/* Usage bars */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Current Period Usage</div>
            <UsageBar label="Requests this minute" current={quota.requestsThisMinute} max={quota.limits.requestsPerMinute} />
            <UsageBar label="Requests today" current={quota.requestsToday} max={quota.limits.requestsPerDay} />
            <UsageBar label="MCP calls this hour" current={quota.mcpCallsThisHour} max={quota.limits.mcpCallsPerHour} />
          </div>
        </>
      )}

      {/* Tier comparison */}
      {tierLimits && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Plan Comparison</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600 }}>Limit</th>
                {(['free', 'pro', 'enterprise'] as TierName[]).map(t => (
                  <th key={t} style={{ padding: '8px 12px', textAlign: 'center', color: TIER_COLORS[t], fontWeight: 700, textTransform: 'capitalize' }}>
                    {t} {quota?.tier === t && '(current)'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Requests / min', key: 'requestsPerMinute' },
                { label: 'Requests / day', key: 'requestsPerDay' },
                { label: 'MCP calls / hr', key: 'mcpCallsPerHour' },
              ].map(({ label, key }) => (
                <tr key={key} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 12px', color: '#374151' }}>{label}</td>
                  {(['free', 'pro', 'enterprise'] as TierName[]).map(t => (
                    <td key={t} style={{ padding: '8px 12px', textAlign: 'center', fontWeight: quota?.tier === t ? 700 : 400 }}>
                      {((tierLimits[t] as Record<string, number>)[key] ?? 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upgrade CTA */}
      {quota && quota.tier !== 'enterprise' && (
        <div style={{ border: '1px solid #ddd6fe', borderRadius: 10, padding: 20, background: '#faf5ff' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#6d28d9', marginBottom: 6 }}>
            Need more capacity?
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
            Upgrade to get higher rate limits and more daily requests.
          </div>
          {upgradeRequested ? (
            <div style={{ color: '#16a34a', fontSize: 13, fontWeight: 600 }}>
              Request submitted — our team will be in touch.
            </div>
          ) : (
            <button
              onClick={() => void requestUpgrade()}
              style={{ padding: '8px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
            >
              Request Upgrade
            </button>
          )}
        </div>
      )}
    </div>
  );
}
