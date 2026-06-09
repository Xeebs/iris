'use client';

import { useState, useEffect } from 'react';

type Subscription = {
  subscriptionId: string;
  entityId: string | null;
  workspaceId: string;
  filters: {
    entityTypes?: string[];
    changeTypes?: string[];
    connectorIds?: string[];
  };
  createdAt: string;
  active: boolean;
};

const CHANGE_TYPES = ['created', 'updated', 'deleted', 'attribute_changed'] as const;
const ENTITY_TYPES = ['contact', 'company', 'deal', 'ticket', 'user', 'product'];

export function NotificationPreferences({ workspaceId = 'default' }: { workspaceId?: string }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [entityId, setEntityId] = useState('');
  const [selectedEntityTypes, setSelectedEntityTypes] = useState<string[]>([]);
  const [selectedChangeTypes, setSelectedChangeTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadSubscriptions() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/entities/subscriptions', {
        headers: { 'x-workspace-id': workspaceId },
      });
      const json = await res.json() as { data: Subscription[] };
      setSubscriptions(json.data ?? []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSubscriptions(); }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createSubscription() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/entities/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({
          entityId: entityId.trim() || null,
          filters: {
            entityTypes: selectedEntityTypes.length ? selectedEntityTypes : undefined,
            changeTypes: selectedChangeTypes.length ? selectedChangeTypes : undefined,
          },
        }),
      });
      const json = await res.json() as { data: Subscription; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Unknown error');
      setSubscriptions((prev) => [json.data, ...prev]);
      setEntityId('');
      setSelectedEntityTypes([]);
      setSelectedChangeTypes([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function cancelSubscription(subscriptionId: string) {
    try {
      await fetch(`/api/v1/entities/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: { 'x-workspace-id': workspaceId },
      });
      setSubscriptions((prev) => prev.filter((s) => s.subscriptionId !== subscriptionId));
    } catch {
      /* silent */
    }
  }

  function toggleItem<T>(arr: T[], item: T): T[] {
    return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 700 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Notification Preferences</h3>

      {/* Create new subscription */}
      <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Add Subscription</div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
            Entity ID (leave blank for workspace-wide)
          </label>
          <input
            type="text"
            placeholder="e.g. contact:123 or company:abc"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Entity Types</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ENTITY_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setSelectedEntityTypes((prev) => toggleItem(prev, t))}
                style={{
                  padding: '3px 10px',
                  border: '1px solid',
                  borderColor: selectedEntityTypes.includes(t) ? '#3b82f6' : '#d1d5db',
                  background: selectedEntityTypes.includes(t) ? '#eff6ff' : '#fff',
                  color: selectedEntityTypes.includes(t) ? '#3b82f6' : '#374151',
                  borderRadius: 12,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Change Types</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHANGE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setSelectedChangeTypes((prev) => toggleItem(prev, t))}
                style={{
                  padding: '3px 10px',
                  border: '1px solid',
                  borderColor: selectedChangeTypes.includes(t) ? '#8b5cf6' : '#d1d5db',
                  background: selectedChangeTypes.includes(t) ? '#f5f3ff' : '#fff',
                  color: selectedChangeTypes.includes(t) ? '#8b5cf6' : '#374151',
                  borderRadius: 12,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ padding: 8, background: '#fef2f2', borderRadius: 6, color: '#dc2626', fontSize: 12, marginBottom: 8 }}>
            {error}
          </div>
        )}

        <button
          onClick={() => void createSubscription()}
          disabled={creating}
          style={{
            padding: '7px 16px',
            background: creating ? '#9ca3af' : '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: creating ? 'not-allowed' : 'pointer',
            fontSize: 13,
          }}
        >
          {creating ? 'Creating…' : 'Add Subscription'}
        </button>
      </div>

      {/* Existing subscriptions */}
      {loading && <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading subscriptions…</div>}

      {subscriptions.length === 0 && !loading && (
        <div style={{ color: '#9ca3af', fontSize: 13, padding: 16, textAlign: 'center' }}>
          No active subscriptions. Add one above.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {subscriptions.map((s) => (
          <div
            key={s.subscriptionId}
            style={{ padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                {s.entityId ?? 'All entities'}
              </div>
              {s.filters.entityTypes && s.filters.entityTypes.length > 0 && (
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  Types: {s.filters.entityTypes.join(', ')}
                </div>
              )}
              {s.filters.changeTypes && s.filters.changeTypes.length > 0 && (
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  Events: {s.filters.changeTypes.join(', ')}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                Created {new Date(s.createdAt).toLocaleDateString()}
              </div>
            </div>
            <button
              onClick={() => void cancelSubscription(s.subscriptionId)}
              style={{ padding: '4px 10px', border: '1px solid #fca5a5', color: '#dc2626', background: '#fef2f2', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
