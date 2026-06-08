'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ConnectorCurationPanel } from '@/components/connector-curation-panel';
import type { ConnectorListing } from '@/components/connector-grid';

type ListingWithRating = ConnectorListing & { avgRating?: number };

type ListingsResponse = {
  data: ConnectorListing[];
  meta: { hasMore: boolean; nextCursor: string | null };
};

export default function MarketplaceCurationPage(): React.JSX.Element {
  const [pending, setPending] = useState<ListingWithRating[]>([]);
  const [published, setPublished] = useState<ListingWithRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'published'>('pending');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  function notify(type: 'success' | 'error', msg: string): void {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 3500);
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pendRes, pubRes] = await Promise.all([
        fetch('/api/v1/marketplace/connectors?isPublished=false'),
        fetch('/api/v1/marketplace/connectors'),
      ]);
      if (pendRes.ok) {
        const body = await pendRes.json() as ListingsResponse;
        setPending(body.data.filter(l => !l.isPublished));
      }
      if (pubRes.ok) {
        const body = await pubRes.json() as ListingsResponse;
        setPublished(body.data.filter(l => l.isPublished));
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleCurate(connectorId: string, publish: boolean): Promise<void> {
    try {
      const res = await fetch(`/api/v1/marketplace/connectors/${connectorId}/curate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish }),
      });
      if (res.ok) {
        notify('success', `${connectorId} ${publish ? 'approved and published' : 'unpublished'}`);
        await loadAll();
      } else {
        notify('error', 'Failed to curate connector');
      }
    } catch {
      notify('error', 'Request failed');
    }
  }

  function dismissPending(connectorId: string): void {
    setPending(prev => prev.filter(l => l.connectorId !== connectorId));
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Admin nav */}
      <nav className="mb-6 flex gap-4 text-sm font-medium text-gray-500">
        <Link href="/admin" className="hover:text-gray-900">Admin</Link>
        <span className="font-semibold text-gray-900">Marketplace Curation</span>
      </nav>

      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Marketplace Curation</h1>
          <p className="mt-1 text-gray-500">Review, approve, and promote connector listings.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-yellow-100 px-3 py-1 font-medium text-yellow-700">
            {pending.length} pending
          </span>
          <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-700">
            {published.length} published
          </span>
        </div>
      </header>

      {/* Notification */}
      {notification && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${
          notification.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {notification.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-4 border-b">
        {(['pending', 'published'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 pb-3 text-sm font-medium capitalize transition ${
              tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t} ({t === 'pending' ? pending.length : published.length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : tab === 'pending' ? (
        <>
          {pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <p className="text-lg font-medium">No pending submissions</p>
              <p className="mt-1 text-sm">All connectors have been reviewed.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((listing) => (
                <ConnectorCurationPanel
                  key={listing.id}
                  listing={listing}
                  onCurate={handleCurate}
                  onDismiss={() => dismissPending(listing.connectorId)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {published.length === 0 ? (
            <p className="py-10 text-center text-gray-400">No published connectors yet.</p>
          ) : (
            published.map((listing) => (
              <div key={listing.id} className="flex items-center justify-between rounded-xl border bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  {listing.iconUrl ? (
                    <img src={listing.iconUrl} alt={listing.name} className="h-10 w-10 rounded-lg object-contain" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 font-bold text-white">
                      {listing.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-gray-900">{listing.name}</p>
                    <p className="text-xs text-gray-500">
                      {listing.workspaceInstallsCount} installs · {listing.category}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCurate(listing.connectorId, false)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Unpublish
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}
