'use client';

import { useState, useEffect, useCallback } from 'react';
import { QuerySuggestionsWidget } from '../../../components/query-suggestions-widget.js';
import { MissingContextAdvisor } from '../../../components/missing-context-advisor.js';

type IndexExpansionRecommendation = {
  connectorType: string;
  entityTypes: string[];
  estimatedQueryCoverage: number;
  rationale: string;
};

/**
 * Query recommendations insights page.
 * Shows suggested queries, missing context advisors, and connector expansion recommendations.
 */
export default function QueryRecommendationsPage() {
  const [recs, setRecs] = useState<IndexExpansionRecommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);

  const loadRecs = useCallback(async () => {
    setRecsLoading(true);
    try {
      const res = await fetch('/api/v1/workspaces/default/index-expansion-recommendations');
      const json = await res.json() as { data?: IndexExpansionRecommendation[] };
      setRecs(json.data ?? []);
    } catch { /* non-critical */ }
    finally { setRecsLoading(false); }
  }, []);

  useEffect(() => { void loadRecs(); }, [loadRecs]);

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Query Recommendations</h1>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
          Suggestions based on your team&apos;s query patterns — discover what to ask next and what context you might be missing.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <QuerySuggestionsWidget />
        <MissingContextAdvisor />
      </div>

      {/* Connector expansion recommendations */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Connector Expansion Recommendations</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Connectors that would cover your most common query patterns.
            </div>
          </div>
          <button onClick={() => void loadRecs()} disabled={recsLoading}
            style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, background: '#fff', cursor: 'pointer' }}>
            {recsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {recs.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            {recsLoading ? 'Analyzing query patterns…' : 'No recommendations yet — more queries needed for pattern analysis.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {recs.map(rec => (
              <div key={rec.connectorType} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>{rec.connectorType}</div>
                  <span style={{ padding: '2px 8px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                    {Math.round(rec.estimatedQueryCoverage * 100)}% coverage
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
                  Entities: {rec.entityTypes.join(', ')}
                </div>
                <div style={{ fontSize: 12, color: '#374151' }}>{rec.rationale}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
