'use client';

import { useEffect, useState } from 'react';

type Subscription = {
  subscriptionId: string;
  entityId: string | null;
  workspaceId: string;
  filters: { entityTypes?: string[]; changeTypes?: string[] };
  createdAt: string;
  active: boolean;
};

export default function SubscriptionManagerPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchSubscriptions();
  }, []);

  async function fetchSubscriptions() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/entity-change-subscriptions', {
        headers: { 'x-workspace-id': 'current' },
      });
      if (res.ok) {
        const body = (await res.json()) as { data: Subscription[] };
        setSubscriptions(body.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/v1/entity-change-subscriptions/${id}`, {
          method: 'DELETE',
          headers: { 'x-workspace-id': 'current' },
        })
      )
    );
    setSelected(new Set());
    await fetchSubscriptions();
  }

  function toggleAll() {
    if (selected.size === subscriptions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(subscriptions.map((s) => s.subscriptionId)));
    }
  }

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Entity Change Subscriptions</h1>
        {selected.size > 0 && (
          <button
            onClick={() => void deleteSelected()}
            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '0.4rem 1rem', cursor: 'pointer' }}
          >
            Delete selected ({selected.size})
          </button>
        )}
      </div>

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading subscriptions…</p>
      ) : subscriptions.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No active subscriptions.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>
                <input type="checkbox" checked={selected.size === subscriptions.length} onChange={toggleAll} />
              </th>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600 }}>Entity ID</th>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600 }}>Types</th>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600 }}>Change Types</th>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((sub) => (
              <tr key={sub.subscriptionId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(sub.subscriptionId)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(sub.subscriptionId)) next.delete(sub.subscriptionId);
                      else next.add(sub.subscriptionId);
                      setSelected(next);
                    }}
                  />
                </td>
                <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                  {sub.entityId ?? '(all)'}
                </td>
                <td style={{ padding: '0.5rem', color: '#6b7280' }}>
                  {sub.filters.entityTypes?.join(', ') ?? '—'}
                </td>
                <td style={{ padding: '0.5rem', color: '#6b7280' }}>
                  {sub.filters.changeTypes?.join(', ') ?? 'all'}
                </td>
                <td style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.8125rem' }}>
                  {new Date(sub.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
