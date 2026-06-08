'use client';

type WebhookDelivery = {
  deliveryId: string;
  webhookId: string;
  eventType: string;
  statusCode: number | null;
  latencyMs: number | null;
  success: boolean;
  errorMessage: string | null;
  retryCount: number;
};

type Props = {
  deliveries: WebhookDelivery[];
  retrying: string | null;
  onRetry: (deliveryId: string, webhookId: string) => void;
};

function StatusBadge({ delivery }: { delivery: WebhookDelivery }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, color: '#dc2626', background: '#fef2f2', fontWeight: 600 }}>
      {delivery.statusCode ?? 'ERR'}
    </span>
  );
}

/**
 * Table of failed webhook deliveries pending manual retry.
 * @param deliveries - Failed deliveries in the retry queue
 * @param retrying - Delivery ID currently being retried (disables its button)
 * @param onRetry - Callback to trigger a retry for a specific delivery
 * @returns Rendered retry queue table or empty state
 */
export function WebhookRetryQueue({ deliveries, retrying, onRetry }: Props) {
  if (deliveries.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 10 }}>
        No failed deliveries in the retry queue.
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
          {['Webhook', 'Event', 'Status', 'Retries', 'Error', 'Actions'].map(h => (
            <th key={h} style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {deliveries.map((d, i) => (
          <tr key={d.deliveryId} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>{d.webhookId}</td>
            <td style={{ padding: '8px 12px' }}>{d.eventType}</td>
            <td style={{ padding: '8px 12px' }}><StatusBadge delivery={d} /></td>
            <td style={{ padding: '8px 12px', color: '#6b7280' }}>{d.retryCount}</td>
            <td style={{ padding: '8px 12px', fontSize: 11, color: '#dc2626', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.errorMessage ?? '—'}
            </td>
            <td style={{ padding: '8px 12px' }}>
              <button
                onClick={() => onRetry(d.deliveryId, d.webhookId)}
                disabled={retrying === d.deliveryId}
                style={{ padding: '3px 10px', background: retrying === d.deliveryId ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: retrying === d.deliveryId ? 'not-allowed' : 'pointer' }}
              >
                {retrying === d.deliveryId ? '…' : 'Retry'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
