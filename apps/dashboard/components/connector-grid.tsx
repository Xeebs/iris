'use client';

import { useState } from 'react';
import { ConnectorDetailModal } from '@/components/connector-detail-modal';

export type ConnectorListing = {
  id: string;
  connectorId: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string | null;
  documentationUrl: string | null;
  author: string | null;
  version: string;
  isOfficial: boolean;
  isPublished: boolean;
  popularityScore: number;
  workspaceInstallsCount: number;
  publishedAt: string | null;
};

type ConnectorGridProps = {
  listings: ConnectorListing[];
  onInstall?: (connectorId: string) => Promise<void>;
};

function StarRating({ score }: { score: number }): React.JSX.Element {
  const normalized = Math.round((score * 5) * 10) / 10;
  return (
    <span className="flex items-center gap-1 text-xs text-amber-500">
      ★ {normalized.toFixed(1)}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }): React.JSX.Element {
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-600">
      {category}
    </span>
  );
}

export function ConnectorGrid({ listings, onInstall }: ConnectorGridProps): React.JSX.Element {
  const [selectedConnector, setSelectedConnector] = useState<ConnectorListing | null>(null);
  const [installing, setInstalling] = useState<Set<string>>(new Set());

  async function handleInstall(connectorId: string): Promise<void> {
    if (!onInstall) return;
    setInstalling(prev => new Set(prev).add(connectorId));
    try {
      await onInstall(connectorId);
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(connectorId);
        return next;
      });
    }
  }

  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-lg font-medium">No connectors found</p>
        <p className="mt-1 text-sm">Try adjusting your search or category filter.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {listings.map((listing) => (
          <div
            key={listing.id}
            className="flex flex-col rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {listing.iconUrl ? (
                  <img src={listing.iconUrl} alt={listing.name} className="h-10 w-10 rounded-lg object-contain" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-lg font-bold text-white">
                    {listing.name.charAt(0)}
                  </div>
                )}
                <div>
                  <h3 className="font-semibold leading-tight text-gray-900">{listing.name}</h3>
                  {listing.isOfficial && (
                    <span className="text-xs font-medium text-indigo-600">Official</span>
                  )}
                </div>
              </div>
              <CategoryBadge category={listing.category} />
            </div>

            <p className="mt-3 flex-1 text-sm text-gray-500 line-clamp-2">{listing.description}</p>

            <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
              <StarRating score={listing.popularityScore} />
              <span>{listing.workspaceInstallsCount.toLocaleString()} installs</span>
            </div>

            {listing.author && (
              <p className="mt-1 text-xs text-gray-400">by {listing.author}</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setSelectedConnector(listing)}
              >
                Details
              </button>
              <button
                type="button"
                disabled={installing.has(listing.connectorId)}
                className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                onClick={() => handleInstall(listing.connectorId)}
              >
                {installing.has(listing.connectorId) ? 'Installing…' : 'Install'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedConnector && (
        <ConnectorDetailModal
          listing={selectedConnector}
          onClose={() => setSelectedConnector(null)}
          onInstall={onInstall ? () => handleInstall(selectedConnector.connectorId) : undefined}
        />
      )}
    </>
  );
}
