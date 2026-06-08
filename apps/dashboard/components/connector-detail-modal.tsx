'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ConnectorListing } from '@/components/connector-grid';

type Review = {
  id: string;
  reviewerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

type RatingsData = {
  reviews: Review[];
  avgRating: number;
};

type ConnectorDetailModalProps = {
  listing: ConnectorListing;
  onClose: () => void;
  onInstall?: () => Promise<void>;
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

function StarBar({ rating, max = 5 }: { rating: number; max?: number }): React.JSX.Element {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={i < Math.round(rating) ? 'text-amber-400' : 'text-gray-200'}>★</span>
      ))}
    </div>
  );
}

export function ConnectorDetailModal({ listing, onClose, onInstall }: ConnectorDetailModalProps): React.JSX.Element {
  const [ratings, setRatings] = useState<RatingsData | null>(null);
  const [userRating, setUserRating] = useState(0);
  const [userComment, setUserComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [tab, setTab] = useState<'overview' | 'reviews'>('overview');

  const loadRatings = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/marketplace/connectors/${listing.connectorId}/ratings`);
      if (res.ok) {
        const body = await res.json() as { data: RatingsData };
        setRatings(body.data);
      }
    } catch {
      // non-fatal
    }
  }, [listing.connectorId]);

  useEffect(() => {
    void loadRatings();
  }, [loadRatings]);

  async function handleInstall(): Promise<void> {
    if (!onInstall) return;
    setInstalling(true);
    try {
      await onInstall();
    } finally {
      setInstalling(false);
    }
  }

  async function handleSubmitReview(): Promise<void> {
    if (userRating === 0) return;
    setSubmitting(true);
    try {
      await fetch(`/api/v1/marketplace/connectors/${listing.connectorId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerId: WORKSPACE_ID, rating: userRating, comment: userComment || undefined }),
      });
      setUserRating(0);
      setUserComment('');
      await loadRatings();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div className="flex items-center gap-4">
            {listing.iconUrl ? (
              <img src={listing.iconUrl} alt={listing.name} className="h-12 w-12 rounded-xl object-contain" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-bold text-white">
                {listing.name.charAt(0)}
              </div>
            )}
            <div>
              <h2 className="text-xl font-bold text-gray-900">{listing.name}</h2>
              <p className="text-sm text-gray-500">
                {listing.isOfficial ? 'Official' : listing.author ?? 'Community'} · v{listing.version}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b px-6">
          {(['overview', 'reviews'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 py-3 text-sm font-medium capitalize transition ${
                tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {tab === 'overview' && (
            <div className="space-y-4">
              <p className="text-gray-700">{listing.description}</p>

              <div className="grid grid-cols-3 gap-4 rounded-xl bg-gray-50 p-4 text-center text-sm">
                <div>
                  <p className="text-lg font-bold text-gray-900">{listing.workspaceInstallsCount.toLocaleString()}</p>
                  <p className="text-gray-500">Installs</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{(listing.popularityScore * 5).toFixed(1)}</p>
                  <p className="text-gray-500">Avg Rating</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{listing.category}</p>
                  <p className="text-gray-500">Category</p>
                </div>
              </div>

              {listing.documentationUrl && (
                <a
                  href={listing.documentationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
                >
                  View documentation →
                </a>
              )}
            </div>
          )}

          {tab === 'reviews' && (
            <div className="space-y-5">
              {ratings && ratings.reviews.length > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-4xl font-bold text-gray-900">{ratings.avgRating.toFixed(1)}</span>
                  <div>
                    <StarBar rating={ratings.avgRating} />
                    <p className="text-sm text-gray-500">{ratings.reviews.length} reviews</p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {ratings?.reviews.map((rev) => (
                  <div key={rev.id} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <StarBar rating={rev.rating} />
                      <span className="text-xs text-gray-400">{new Date(rev.createdAt).toLocaleDateString()}</span>
                    </div>
                    {rev.comment && <p className="mt-2 text-sm text-gray-700">{rev.comment}</p>}
                  </div>
                ))}
              </div>

              {/* Submit review */}
              <div className="border-t pt-4">
                <p className="mb-2 text-sm font-medium text-gray-700">Leave a review</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setUserRating(n)}
                      className={`text-2xl ${n <= userRating ? 'text-amber-400' : 'text-gray-200'}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <textarea
                  value={userComment}
                  onChange={(e) => setUserComment(e.target.value)}
                  placeholder="Share your experience (optional)"
                  rows={2}
                  className="mt-2 w-full rounded-lg border px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  disabled={userRating === 0 || submitting}
                  onClick={() => void handleSubmitReview()}
                  className="mt-2 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Submit Review'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {onInstall && (
          <div className="border-t px-6 py-4">
            <button
              type="button"
              disabled={installing}
              onClick={() => void handleInstall()}
              className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {installing ? 'Installing…' : `Install ${listing.name}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
