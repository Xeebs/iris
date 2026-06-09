'use client';

import { useEffect, useState } from 'react';

type StaleEntity = {
  entityId: string;
  entityType: string;
  ageSeconds: number;
  slaSec: number | null;
  slaBreached: boolean;
  stalenessWarning: boolean;
};

type Props = {
  connectorId?: string;
  limit?: number;
  onEntityClick?: (entityId: string) => void;
};

/**
 * Panel showing entities approaching or exceeding their freshness SLA.
 */
export function StalenessAlertsPanel({ connectorId, limit = 20, onEntityClick }: Props) {
  const [entities, setEntities] = useState<StaleEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (connectorId) params.set('connectorId', connectorId);

    fetch(`/api/v1/freshness/stale?${params}`)
      .then((r) => r.json())
      .then((body) => setEntities(body.data ?? []))
      .catch(() => setError('Failed to load stale entities'))
      .finally(() => setLoading(false));
  }, [connectorId, limit]);

  function formatAge(sec: number): string {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
    return `${(sec / 86400).toFixed(1)}d`;
  }

  function slaLabel(entity: StaleEntity): string {
    if (!entity.slaSec) return 'No SLA';
    const remaining = entity.slaSec - entity.ageSeconds;
    if (entity.slaBreached) return `Breached ${formatAge(Math.abs(remaining))} ago`;
    return `${formatAge(remaining)} until breach`;
  }

  const breached = entities.filter((e) => e.slaBreached);
  const warning = entities.filter((e) => !e.slaBreached && e.stalenessWarning);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 rounded bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const renderRow = (entity: StaleEntity) => (
    <div
      key={entity.entityId}
      className={`flex items-start justify-between rounded-md px-3 py-2 text-sm transition-colors ${
        entity.slaBreached
          ? 'bg-red-50 hover:bg-red-100'
          : 'bg-amber-50 hover:bg-amber-100'
      } ${onEntityClick ? 'cursor-pointer' : ''}`}
      onClick={() => onEntityClick?.(entity.entityId)}
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-gray-700">{entity.entityId}</p>
        <p className="mt-0.5 text-xs capitalize text-gray-500">{entity.entityType}</p>
      </div>
      <div className="ml-4 shrink-0 text-right">
        <p
          className={`text-xs font-semibold ${
            entity.slaBreached ? 'text-red-700' : 'text-amber-700'
          }`}
        >
          {formatAge(entity.ageSeconds)}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">{slaLabel(entity)}</p>
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Staleness Alerts</h3>
        <div className="flex gap-2 text-xs">
          {breached.length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
              {breached.length} breached
            </span>
          )}
          {warning.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
              {warning.length} warning
            </span>
          )}
        </div>
      </div>

      {entities.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-4">All entities are within SLA.</p>
      ) : (
        <div className="space-y-2">
          {breached.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-red-600">Breached</p>
              <div className="space-y-1">{breached.map(renderRow)}</div>
            </div>
          )}
          {warning.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-600">
                Approaching SLA
              </p>
              <div className="space-y-1">{warning.map(renderRow)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
