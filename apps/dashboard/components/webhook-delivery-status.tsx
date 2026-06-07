'use client';

import { useState, useEffect, useCallback } from 'react';

type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead';

interface WebhookEvent {
  id: string;
  workspaceId: string;
  webhookId: string;
  eventType: string;
  targetUrl: string;
  status: DeliveryStatus;
  attemptCount: number;
  httpStatus: number | null;
  errorMessage: string | null;
  nextRetryAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface EventsResponse {
  data: WebhookEvent[];
  meta: { hasMore: boolean; nextCursor?: string };
}

type Props = {
  workspaceId: string;
};

const STATUS_STYLES: Record<DeliveryStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  dead: 'bg-gray-100 text-gray-500',
};

const STATUS_FILTERS: { label: string; value: DeliveryStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Failed', value: 'failed' },
  { label: 'Dead', value: 'dead' },
];

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export function WebhookDeliveryStatus({ workspaceId }: Props) {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<DeliveryStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (newFilter: DeliveryStatus | '', newCursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspaceId, limit: '25' });
      if (newFilter) params.set('status', newFilter);
      if (newCursor) params.set('cursor', newCursor);
      const res = await fetch(`/api/v1/webhooks/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as EventsResponse;
      setEvents((prev) => newCursor ? [...prev, ...body.data] : body.data);
      setHasMore(body.meta.hasMore);
      setCursor(body.meta.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(filter); }, [filter, load]);

  function handleFilterChange(val: DeliveryStatus | '') {
    setFilter(val);
    setEvents([]);
    setCursor(undefined);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Webhook Delivery</h2>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => handleFilterChange(f.value)}
              className={`px-2 py-1 text-xs rounded font-medium ${
                filter === f.value
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => load(filter)}
            className="px-2 py-1 text-xs rounded text-blue-600 hover:text-blue-800"
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-600 text-xs rounded">
          {error}
        </div>
      )}

      {events.length === 0 && !loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          No webhook events {filter ? `with status "${filter}"` : ''}.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {events.map((evt) => (
            <div key={evt.id} className="py-3 flex items-start gap-3">
              <span className={`mt-0.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLES[evt.status]}`}>
                {evt.status}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 truncate">{evt.eventType}</span>
                  {evt.httpStatus && (
                    <span className="text-xs text-gray-400">HTTP {evt.httpStatus}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 truncate">{evt.targetUrl}</p>
                {evt.errorMessage && (
                  <p className="text-xs text-red-500 mt-0.5 line-clamp-1">{evt.errorMessage}</p>
                )}
                {evt.nextRetryAt && evt.status === 'failed' && (
                  <p className="text-xs text-yellow-500 mt-0.5">
                    Retry at {new Date(evt.nextRetryAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400">{formatRelative(evt.createdAt)}</span>
                <p className="text-xs text-gray-400">attempt {evt.attemptCount}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <p className="text-center text-sm text-gray-400 py-4">Loading…</p>
      )}

      {hasMore && !loading && (
        <button
          onClick={() => load(filter, cursor)}
          className="w-full mt-3 py-2 text-sm text-blue-600 hover:text-blue-800"
        >
          Load more
        </button>
      )}
    </div>
  );
}
