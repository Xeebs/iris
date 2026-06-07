'use client';

import { useState } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

type DuplicateSignals = {
  nameSimilarity: number;
  emailDomainMatch: boolean;
  embeddingSimilarity: number;
  compositeScore: number;
};

type DuplicatePair = {
  entityA: { id: string; type: string; label: string };
  entityB: { id: string; type: string; label: string };
  signals: DuplicateSignals;
  confidence: 'high' | 'medium' | 'low';
};

type DeduplicationReport = {
  workspaceId: string;
  scannedCount: number;
  candidatePairs: DuplicatePair[];
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  analyzedAt: string;
};

async function analyzeDedup(
  workspaceId: string,
  entityType: string,
  threshold: number,
): Promise<DeduplicationReport> {
  const params = new URLSearchParams({ threshold: String(threshold) });
  if (entityType) params.set('entityType', entityType);

  const res = await fetch(`${API_BASE}/admin/dedup/analyze?${params.toString()}`, {
    method: 'POST',
    headers: { 'x-workspace-id': workspaceId },
    credentials: 'include',
  });

  if (!res.ok) {
    const body = (await res.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Analysis failed: ${res.statusText}`);
  }

  const body = (await res.json()) as { data: DeduplicationReport };
  return body.data;
}

async function mergePair(
  workspaceId: string,
  canonicalId: string,
  duplicateId: string,
  signals: DuplicateSignals,
): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/dedup/merge/${canonicalId}/${duplicateId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-workspace-id': workspaceId,
    },
    credentials: 'include',
    body: JSON.stringify({ mergedBy: 'dashboard-admin', signals }),
  });

  if (!res.ok) {
    const body = (await res.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Merge failed: ${res.statusText}`);
  }
}

const CONFIDENCE_STYLES: Record<string, { background: string; color: string }> = {
  high: { background: '#dcfce7', color: '#15803d' },
  medium: { background: '#fef9c3', color: '#a16207' },
  low: { background: '#f3f4f6', color: '#6b7280' },
};

export default function DedupAdminPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [threshold, setThreshold] = useState('0.60');
  const [report, setReport] = useState<DeduplicationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergedPairs, setMergedPairs] = useState<Set<string>>(new Set());
  const [mergeError, setMergeError] = useState<string | null>(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    setReport(null);
    setMergedPairs(new Set());
    try {
      const result = await analyzeDedup(workspaceId || 'default', entityType, parseFloat(threshold));
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleMerge(pair: DuplicatePair) {
    setMergeError(null);
    const pairKey = `${pair.entityA.id}::${pair.entityB.id}`;
    try {
      await mergePair(
        workspaceId || 'default',
        pair.entityA.id,
        pair.entityB.id,
        pair.signals,
      );
      setMergedPairs((prev) => new Set([...prev, pairKey]));
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Merge failed');
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Entity Deduplication
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '0.875rem' }}>
        Detect and merge duplicate entities across connectors using name similarity, email domain,
        and embedding vectors.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Workspace ID (optional)"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', minWidth: '220px' }}
        />
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', minWidth: '160px' }}
        >
          <option value="">All entity types</option>
          <option value="contact">Contact</option>
          <option value="company">Company</option>
          <option value="deal">Deal</option>
          <option value="activity">Activity</option>
          <option value="ticket">Ticket</option>
          <option value="product">Product</option>
        </select>
        <input
          type="number"
          placeholder="Threshold (0–1)"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          min="0"
          max="1"
          step="0.05"
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', width: '140px' }}
        />
        <button
          onClick={handleAnalyze}
          disabled={loading}
          style={{
            padding: '0.5rem 1.25rem',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {loading ? 'Scanning…' : 'Scan for Duplicates'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {mergeError && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Merge error: {mergeError}
        </div>
      )}

      {report && (
        <div>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <Stat label="Entities scanned" value={report.scannedCount} />
            <Stat label="Candidate pairs" value={report.candidatePairs.length} />
            <Stat label="High confidence" value={report.highConfidenceCount} highlight />
            <Stat label="Medium confidence" value={report.mediumConfidenceCount} />
          </div>

          {report.candidatePairs.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>No duplicate candidates found above the threshold.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Entity A</th>
                  <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Entity B</th>
                  <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Name sim.</th>
                  <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Email match</th>
                  <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Emb. sim.</th>
                  <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Score</th>
                  <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Confidence</th>
                  <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {report.candidatePairs.map((pair) => {
                  const pairKey = `${pair.entityA.id}::${pair.entityB.id}`;
                  const merged = mergedPairs.has(pairKey);
                  const style = CONFIDENCE_STYLES[pair.confidence] ?? CONFIDENCE_STYLES['low']!;
                  return (
                    <tr key={pairKey} style={{ borderBottom: '1px solid #f3f4f6', opacity: merged ? 0.5 : 1 }}>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <div style={{ fontWeight: 500 }}>{pair.entityA.label}</div>
                        <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{pair.entityA.type} · {pair.entityA.id.slice(0, 12)}</div>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <div style={{ fontWeight: 500 }}>{pair.entityB.label}</div>
                        <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{pair.entityB.type} · {pair.entityB.id.slice(0, 12)}</div>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{(pair.signals.nameSimilarity * 100).toFixed(0)}%</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{pair.signals.emailDomainMatch ? 'Yes' : 'No'}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{(pair.signals.embeddingSimilarity * 100).toFixed(0)}%</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{(pair.signals.compositeScore * 100).toFixed(0)}%</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ ...style, borderRadius: '9999px', padding: '0.125rem 0.625rem', fontWeight: 600, fontSize: '0.75rem' }}>
                          {pair.confidence}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        {merged ? (
                          <span style={{ color: '#15803d', fontWeight: 500 }}>Merged</span>
                        ) : (
                          <button
                            onClick={() => handleMerge(pair)}
                            style={{
                              padding: '0.25rem 0.75rem',
                              background: '#2563eb',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            Merge
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '1rem' }}>
            Analyzed at {new Date(report.analyzedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? '#eff6ff' : '#f9fafb',
      border: `1px solid ${highlight ? '#bfdbfe' : '#e5e7eb'}`,
      borderRadius: '8px',
      padding: '0.75rem 1.25rem',
      minWidth: '120px',
    }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: highlight ? '#1d4ed8' : '#111827' }}>
        {value}
      </div>
      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{label}</div>
    </div>
  );
}
