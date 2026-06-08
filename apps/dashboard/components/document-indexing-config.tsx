'use client';

import { useState, useEffect } from 'react';

interface ConnectorDocStats {
  sourceConnectorId: string;
  documentCount: number;
  totalTokens: number;
  lastExtractedAt: string | null;
}

interface DocumentIndexingConfigProps {
  apiBase?: string;
}

function tokensToCost(tokens: number): string {
  // text-embedding-3-small: $0.02 / 1M tokens
  const cost = (tokens / 1_000_000) * 0.02;
  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function DocumentIndexingConfig({ apiBase = '/api/v1' }: DocumentIndexingConfigProps) {
  const [stats, setStats] = useState<ConnectorDocStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ documentTitle: string; excerpt: string; sourceEntityId: string }> | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void fetchStats();
  }, []);

  async function fetchStats() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/document-indexing/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: ConnectorDocStats[] };
      setStats(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(connectorId: string) {
    if (!confirm(`Remove all indexed documents for connector ${connectorId}?`)) return;
    setDeleting(connectorId);
    try {
      const res = await fetch(`${apiBase}/document-indexing/connector/${connectorId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const res = await fetch(`${apiBase}/document-indexing/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: Array<{ documentTitle: string; excerpt: string; sourceEntityId: string }> };
      setSearchResults(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  const totalDocs = stats.reduce((s, r) => s + r.documentCount, 0);
  const totalTokens = stats.reduce((s, r) => s + r.totalTokens, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Indexed Documents', value: totalDocs.toLocaleString() },
          { label: 'Total Tokens', value: totalTokens.toLocaleString() },
          { label: 'Est. Embedding Cost', value: tokensToCost(totalTokens) },
          { label: 'Connectors with Docs', value: stats.length.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'white' }}>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{label}</p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>{value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Full-text search */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', overflow: 'hidden' }}>
        <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
            placeholder="Search indexed documents…"
            style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem' }}
          />
          <button
            onClick={() => void handleSearch()}
            disabled={searching}
            style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
          >
            {searching ? '…' : 'Search'}
          </button>
        </div>

        {searchResults !== null && (
          <div style={{ padding: '1rem' }}>
            {searchResults.length === 0 ? (
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.875rem' }}>No results found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {searchResults.map((r, i) => (
                  <div key={i} style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                    <p style={{ margin: '0 0 0.25rem', fontWeight: 600, fontSize: '0.875rem', color: '#111827' }}>{r.documentTitle}</p>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: '#374151', fontStyle: 'italic' }}>{r.excerpt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Per-connector table */}
      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading…</p>
      ) : stats.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>No documents indexed yet. Enable "Extract Document Content" on a connector to start.</p>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {['Connector', 'Documents', 'Tokens', 'Est. Cost', 'Last Indexed', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.sourceConnectorId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8125rem', color: '#111827' }}>{s.sourceConnectorId}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#374151' }}>{s.documentCount.toLocaleString()}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#374151' }}>{s.totalTokens.toLocaleString()}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#374151' }}>{tokensToCost(s.totalTokens)}</td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#64748b' }}>{formatDate(s.lastExtractedAt)}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <button
                      onClick={() => void handleDelete(s.sourceConnectorId)}
                      disabled={deleting === s.sourceConnectorId}
                      style={{ padding: '0.25rem 0.625rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {deleting === s.sourceConnectorId ? '…' : 'Clear'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
