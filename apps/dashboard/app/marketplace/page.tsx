'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ConnectorGrid } from '@/components/connector-grid';
import type { ConnectorListing } from '@/components/connector-grid';

const CATEGORIES = ['all', 'crm', 'analytics', 'productivity', 'finance', 'engineering', 'general'];

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

export default function MarketplacePage(): React.JSX.Element {
  const [listings, setListings] = useState<ConnectorListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState<string | null>(null);

  const loadListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== 'all') params.set('category', category);

      const res = await fetch(`/api/v1/marketplace/connectors?${params.toString()}`);
      if (res.ok) {
        const body = await res.json() as { data: ConnectorListing[] };
        setListings(body.data);
      }
    } catch {
      // non-fatal — show empty state
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  async function handleInstall(connectorId: string): Promise<void> {
    try {
      const res = await fetch(`/api/v1/marketplace/connectors/${connectorId}/install`, {
        method: 'POST',
        headers: { 'x-workspace-id': WORKSPACE_ID },
      });
      if (res.ok) {
        setInstalled(prev => new Set(prev).add(connectorId));
        setNotification(`${connectorId} installed successfully`);
        setTimeout(() => setNotification(null), 3000);
      }
    } catch {
      // non-fatal
    }
  }

  const filtered = listings.filter(
    (l) =>
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.description.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      {/* Nav */}
      <nav className="mb-6 flex gap-4 text-sm font-medium text-gray-500">
        <Link href="/" className="hover:text-gray-900">Overview</Link>
        <Link href="/connectors" className="hover:text-gray-900">My Connectors</Link>
        <span className="font-semibold text-gray-900">Marketplace</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Connector Marketplace</h1>
        <p className="mt-2 text-gray-500">Browse and install connectors to power your AI context layer.</p>
      </header>

      {/* Notification */}
      {notification && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {notification}
        </div>
      )}

      {/* Search + filter row */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search connectors…"
          className="w-full rounded-lg border px-4 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                category === cat
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <ConnectorGrid
          listings={filtered.map(l => ({ ...l, isInstalled: installed.has(l.connectorId) }))}
          onInstall={handleInstall}
        />
      )}

      {/* Submit CTA */}
      <div className="mt-12 rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 p-8 text-center">
        <h2 className="text-xl font-bold text-gray-900">Built a connector?</h2>
        <p className="mt-2 text-sm text-gray-600">Share it with the Iris community and reach thousands of workspaces.</p>
        <Link
          href="/connectors/submit"
          className="mt-4 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Submit a Connector
        </Link>
      </div>
    </main>
  );
}
