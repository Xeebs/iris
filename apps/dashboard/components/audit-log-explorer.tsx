'use client';

import { useState, useCallback } from 'react';

type EventType = 'access' | 'export' | 'delete' | 'modify' | 'share';

interface AuditEvent {
  id: string;
  eventType: EventType;
  entityId: string | null;
  accessedFields: string[];
  userId: string;
  toolName: string | null;
  ipAddress: string | null;
  occurredAt: string;
}

interface AuditLogExplorerProps {
  workspaceId: string;
}

const EVENT_TYPE_STYLES: Record<EventType, string> = {
  access: 'bg-blue-100 text-blue-700',
  export: 'bg-purple-100 text-purple-700',
  delete: 'bg-red-100 text-red-700',
  modify: 'bg-yellow-100 text-yellow-700',
  share: 'bg-green-100 text-green-700',
};

/**
 * Searchable audit log explorer with user/entity/event-type filters.
 */
export function AuditLogExplorer({ workspaceId }: AuditLogExplorerProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [eventType, setEventType] = useState<EventType | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (entityId) params.set('entityId', entityId);
    if (eventType) params.set('eventType', eventType);
    params.set('limit', '100');

    try {
      const res = await fetch(`/api/v1/compliance/audit-log?${params}`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const json = (await res.json()) as { data: AuditEvent[] };
      setEvents(json.data);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, userId, entityId, eventType]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          type="text"
          placeholder="Filter by user ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="Filter by entity ID"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value as EventType | '')}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="">All event types</option>
          <option value="access">access</option>
          <option value="export">export</option>
          <option value="delete">delete</option>
          <option value="modify">modify</option>
          <option value="share">share</option>
        </select>
      </div>

      <button
        type="button"
        onClick={() => void search()}
        disabled={loading}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Searching…' : 'Search'}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {searched && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {events.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No events found for the given filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">Entity</th>
                  <th className="px-4 py-2 font-medium">Tool</th>
                  <th className="px-4 py-2 font-medium">Fields</th>
                </tr>
              </thead>
              <tbody>
                {events.map((evt) => (
                  <tr key={evt.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(evt.occurredAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${EVENT_TYPE_STYLES[evt.eventType]}`}>
                        {evt.eventType}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{evt.userId}</td>
                    <td className="px-4 py-2 text-gray-600 font-mono text-xs">{evt.entityId ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{evt.toolName ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">
                      {evt.accessedFields.length > 0 ? evt.accessedFields.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
