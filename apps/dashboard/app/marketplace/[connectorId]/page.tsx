'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ConnectorDetailPanel } from '@/components/connector-detail-panel';
import { DependencyGraphViewer } from '@/components/dependency-graph-viewer';
import type { ConnectorDetailProps, ConnectorVersion } from '@/components/connector-detail-panel';
import type { DependencyNode } from '@/components/dependency-graph-viewer';

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; detail: ConnectorDetailProps; depTree: DependencyNode | null };

export default function ConnectorDetailPage() {
  const params = useParams();
  const connectorId = params['connectorId'] as string;
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (!connectorId) return;
    void loadDetail(connectorId);
  }, [connectorId]);

  async function loadDetail(id: string) {
    setState({ status: 'loading' });
    try {
      const [listingRes, reviewsRes, versionsRes] = await Promise.all([
        fetch(`/api/v1/marketplace/connectors/${encodeURIComponent(id)}`, {
          headers: { 'x-workspace-id': WORKSPACE_ID },
        }),
        fetch(`/api/v1/marketplace/connectors/${encodeURIComponent(id)}/reviews`, {
          headers: { 'x-workspace-id': WORKSPACE_ID },
        }),
        fetch(`/api/v1/marketplace/connectors/${encodeURIComponent(id)}/versions`, {
          headers: { 'x-workspace-id': WORKSPACE_ID },
        }),
      ]);

      if (!listingRes.ok) {
        setState({ status: 'error', message: `Connector not found (${listingRes.status})` });
        return;
      }

      const listingBody = await listingRes.json() as { data: Record<string, unknown> };
      const reviewsBody = reviewsRes.ok ? await reviewsRes.json() as { data: { avgRating: number; reviews: unknown[] } } : null;
      const versionsBody = versionsRes.ok ? await versionsRes.json() as { data: ConnectorVersion[] } : null;

      const listing = listingBody.data;
      const detail: ConnectorDetailProps = {
        id: listing['id'] as string,
        name: listing['name'] as string,
        description: listing['description'] as string,
        category: listing['category'] as string,
        author: listing['author'] as string | null,
        iconUrl: listing['iconUrl'] as string | null,
        documentationUrl: listing['documentationUrl'] as string | null,
        isOfficial: listing['isOfficial'] as boolean,
        popularityScore: listing['popularityScore'] as number,
        workspaceInstallsCount: listing['workspaceInstallsCount'] as number,
        versions: versionsBody?.data ?? [],
        avgRating: reviewsBody?.data?.avgRating ?? 0,
        reviewCount: reviewsBody?.data?.reviews?.length ?? 0,
        isInstalled,
        onInstall: async () => {
          const r = await fetch(`/api/v1/marketplace/connectors/${encodeURIComponent(id)}/install`, {
            method: 'POST',
            headers: { 'x-workspace-id': WORKSPACE_ID, 'content-type': 'application/json' },
          });
          if (r.ok) setIsInstalled(true);
        },
      };
      setState({ status: 'loaded', detail, depTree: null });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center">
        <div className="text-gray-500">Loading connector details...</div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
        <Link href="/marketplace" className="text-blue-400 hover:text-blue-300 text-sm mb-6 inline-block">Back to Marketplace</Link>
        <div className="text-red-400">{state.message}</div>
      </div>
    );
  }

  const { detail, depTree } = state;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <Link href="/marketplace" className="text-blue-400 hover:text-blue-300 text-sm mb-6 inline-block">
        Back to Marketplace
      </Link>

      <div className="max-w-4xl space-y-6">
        <ConnectorDetailPanel
          {...detail}
          isInstalled={isInstalled}
          onInstall={async () => {
            await detail.onInstall();
          }}
        />

        {depTree && (
          <DependencyGraphViewer root={depTree} />
        )}
      </div>
    </div>
  );
}
