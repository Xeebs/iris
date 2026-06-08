'use client';

import { useState } from 'react';
import type { ConnectorListing } from '@/components/connector-grid';

type CurationPanelProps = {
  listing: ConnectorListing & { avgRating?: number };
  onCurate: (connectorId: string, publish: boolean) => Promise<void>;
  onDismiss: () => void;
};

export function ConnectorCurationPanel({ listing, onCurate, onDismiss }: CurationPanelProps): React.JSX.Element {
  const [processing, setProcessing] = useState(false);

  async function handle(publish: boolean): Promise<void> {
    setProcessing(true);
    try {
      await onCurate(listing.connectorId, publish);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        {listing.iconUrl ? (
          <img src={listing.iconUrl} alt={listing.name} className="h-12 w-12 rounded-lg object-contain" />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-xl font-bold text-white">
            {listing.name.charAt(0)}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{listing.name}</h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-600">
              {listing.category}
            </span>
            {listing.isOfficial && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                Official
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500 line-clamp-2">{listing.description}</p>
          {listing.author && (
            <p className="mt-1 text-xs text-gray-400">by {listing.author} · v{listing.version}</p>
          )}
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
            <span>⬇ {listing.workspaceInstallsCount.toLocaleString()} installs</span>
            {listing.avgRating !== undefined && (
              <span>★ {listing.avgRating.toFixed(1)} avg rating</span>
            )}
            {listing.documentationUrl && (
              <a
                href={listing.documentationUrl}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 hover:underline"
              >
                Docs ↗
              </a>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            disabled={processing}
            onClick={() => void handle(true)}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => void handle(false)}
            className="rounded-lg bg-red-50 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-600"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
