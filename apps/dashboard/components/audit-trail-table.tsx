'use client';

import { useState } from 'react';

type AuditEvent = {
  eventId: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  durationMs: number;
  bytesReturned: number;
  createdAt: string;
};

type AuditTrailTableProps = {
  events: AuditEvent[];
  onExportCsv?: () => void;
};

export function AuditTrailTable({ events, onExportCsv }: AuditTrailTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<keyof AuditEvent>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = events
    .filter((e) => {
      const q = search.toLowerCase();
      return !q || e.actor.toLowerCase().includes(q) || e.action.toLowerCase().includes(q) || e.resourceType.toLowerCase().includes(q) || e.resourceId.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const cmp = String(av).localeCompare(String(bv));
      return sortAsc ? cmp : -cmp;
    });

  function toggleSort(field: keyof AuditEvent) {
    if (sortField === field) setSortAsc((v) => !v);
    else { setSortField(field); setSortAsc(true); }
  }

  function exportCsv() {
    if (onExportCsv) { onExportCsv(); return; }
    const header = 'eventId,actor,action,resourceType,resourceId,durationMs,bytesReturned,createdAt';
    const rows = filtered.map((e) => [e.eventId, e.actor, e.action, e.resourceType, e.resourceId, e.durationMs, e.bytesReturned, e.createdAt].join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-trail.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const Th = ({ field, label }: { field: keyof AuditEvent; label: string }) => (
    <th
      onClick={() => toggleSort(field)}
      style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem', color: '#6b7280', background: '#f9fafb', cursor: 'pointer', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap', userSelect: 'none' }}
    >
      {label} {sortField === field ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search actor, action, resource…"
          style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem' }}
        />
        <button
          onClick={exportCsv}
          style={{ padding: '0.4rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.875rem', color: '#374151' }}
        >
          Export CSV
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr>
              <Th field="createdAt" label="Time" />
              <Th field="actor" label="Actor" />
              <Th field="action" label="Action" />
              <Th field="resourceType" label="Resource" />
              <Th field="resourceId" label="Resource ID" />
              <Th field="durationMs" label="Duration (ms)" />
              <Th field="bytesReturned" label="Bytes" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                  No audit events found.
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.eventId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.45rem 0.75rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', fontWeight: 500, color: '#111827' }}>{e.actor}</td>
                  <td style={{ padding: '0.45rem 0.75rem' }}>
                    <span style={{ background: '#f0f9ff', color: '#0369a1', borderRadius: 3, padding: '0.1rem 0.4rem', fontSize: '0.75rem', fontWeight: 500 }}>
                      {e.action}
                    </span>
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', color: '#374151' }}>{e.resourceType}</td>
                  <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.resourceId}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: '#374151' }}>{e.durationMs}</td>
                  <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: '#374151' }}>{e.bytesReturned.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.4rem' }}>
        Showing {filtered.length} of {events.length} events
      </p>
    </div>
  );
}
