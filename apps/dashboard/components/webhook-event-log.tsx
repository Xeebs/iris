'use client';

type WebhookDelivery = {
  deliveryId: string;
  webhookId: string;
  eventType: string;
  statusCode: number | null;
  latencyMs: number | null;
  success: boolean;
  requestBody: string;
  responseBody: string | null;
  errorMessage: string | null;
  deliveredAt: string;
  retryCount: number;
};

type Props = {
  deliveries: WebhookDelivery[];
  webhookId: string | null;
};

function StatusBadge({ delivery }: { delivery: WebhookDelivery }) {
  const color = delivery.success ? '#16a34a' : '#dc2626';
  const bg = delivery.success ? '#f0fdf4' : '#fef2f2';
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, color, background: bg, fontWeight: 600 }}>
      {delivery.success ? `${delivery.statusCode ?? 'OK'}` : `${delivery.statusCode ?? 'ERR'}`}
    </span>
  );
}

/**
 * Table of recent webhook delivery events with status, latency, and details.
 * @param deliveries - List of delivery records to display
 * @param webhookId - Currently selected webhook ID; null triggers empty-state message
 * @returns Rendered event log table
 */
export function WebhookEventLog({ deliveries, webhookId }: Props) {
  if (!webhookId) {
    return (
      <p style={{ color: '#9ca3af' }}>Select a webhook from the Webhooks tab to view its event log.</p>
    );
  }

  if (deliveries.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 10 }}>
        No deliveries recorded for this webhook yet.
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
          {['Event', 'Status', 'Latency', 'Time', 'Details'].map(h => (
            <th key={h} style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {deliveries.map((d, i) => (
          <tr key={d.deliveryId} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
            <td style={{ padding: '8px 12px' }}>{d.eventType}</td>
            <td style={{ padding: '8px 12px' }}><StatusBadge delivery={d} /></td>
            <td style={{ padding: '8px 12px', color: '#6b7280' }}>
              {d.latencyMs != null ? `${d.latencyMs}ms` : '—'}
            </td>
            <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 11 }}>
              {new Date(d.deliveredAt).toLocaleString()}
            </td>
            <td style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.errorMessage ?? d.responseBody ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
