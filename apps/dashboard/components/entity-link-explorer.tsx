'use client';

import { useState } from 'react';

interface EntityLink {
  id: string;
  entityIdA: string;
  connectorA: string;
  entityIdB: string;
  connectorB: string;
  confidence: number;
  matchSignals: Record<string, unknown> | null;
  status: 'proposed' | 'confirmed' | 'rejected';
}

interface EntityLinkExplorerProps {
  links: EntityLink[];
  onConfirm: (linkId: string) => Promise<void>;
  onReject: (linkId: string) => Promise<void>;
  loading?: boolean;
}

function confidenceColor(c: number): string {
  if (c >= 0.90) return 'text-green-600';
  if (c >= 0.75) return 'text-yellow-600';
  return 'text-orange-600';
}

function shortId(entityId: string): string {
  const parts = entityId.split(':');
  return parts.slice(-2).join(':');
}

export function EntityLinkExplorer({ links, onConfirm, onReject, loading }: EntityLinkExplorerProps) {
  const [processing, setProcessing] = useState<string | null>(null);

  if (loading) return <p className="text-sm text-muted-foreground">Loading entity links…</p>;
  if (links.length === 0) return <p className="text-sm text-muted-foreground">No cross-connector links found.</p>;

  async function handle(linkId: string, action: 'confirm' | 'reject') {
    setProcessing(linkId);
    try {
      if (action === 'confirm') await onConfirm(linkId);
      else await onReject(linkId);
    } finally {
      setProcessing(null);
    }
  }

  const proposed = links.filter((l) => l.status === 'proposed');
  const resolved = links.filter((l) => l.status !== 'proposed');

  return (
    <div className="space-y-4">
      {proposed.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Proposed Links ({proposed.length})</h3>
          <div className="space-y-2">
            {proposed.map((link) => (
              <div key={link.id} className="border rounded p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs bg-muted rounded px-1 py-0.5">{link.connectorA}</span>
                  <span className="text-muted-foreground text-xs">{shortId(link.entityIdA)}</span>
                  <span className="text-muted-foreground">↔</span>
                  <span className="font-mono text-xs bg-muted rounded px-1 py-0.5">{link.connectorB}</span>
                  <span className="text-muted-foreground text-xs">{shortId(link.entityIdB)}</span>
                  <span className={`ml-auto font-bold text-xs ${confidenceColor(link.confidence)}`}>
                    {(link.confidence * 100).toFixed(0)}% match
                  </span>
                </div>
                {link.matchSignals && (
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    {link.matchSignals['emailDomainMatch'] === true && <span>✓ email domain</span>}
                    {link.matchSignals['phoneMatch'] === true && <span>✓ phone</span>}
                    {typeof link.matchSignals['nameSimilarity'] === 'number' && (
                      <span>name: {((link.matchSignals['nameSimilarity'] as number) * 100).toFixed(0)}%</span>
                    )}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void handle(link.id, 'confirm')}
                    disabled={processing === link.id}
                    className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => void handle(link.id, 'reject')}
                    disabled={processing === link.id}
                    className="text-xs px-2 py-1 border rounded hover:bg-muted disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 text-muted-foreground">Resolved ({resolved.length})</h3>
          <div className="space-y-1">
            {resolved.map((link) => (
              <div key={link.id} className="flex items-center gap-2 text-xs text-muted-foreground border rounded px-3 py-2">
                <span className={link.status === 'confirmed' ? 'text-green-600' : 'text-red-500'}>
                  {link.status === 'confirmed' ? '✓' : '✗'}
                </span>
                <span>{link.connectorA}:{shortId(link.entityIdA)}</span>
                <span>↔</span>
                <span>{link.connectorB}:{shortId(link.entityIdB)}</span>
                <span className="ml-auto">{(link.confidence * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
