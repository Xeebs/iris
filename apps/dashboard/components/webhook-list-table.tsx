'use client';

type WebhookConfig = {
  webhookId: string;
  targetUrl: string;
  eventTypes: string[];
  active: boolean;
  lastDeliveryAt: string | null;
  lastDeliverySuccess: boolean | null;
};

type Props = {
  webhooks: WebhookConfig[];
  loading: boolean;
  onSelect: (webhookId: string) => void;
};

/**
 * Table displaying all configured webhooks with their status and last delivery.
 * @param webhooks - List of webhook configurations to display
 * @param loading - Whether data is currently loading
 * @param onSelect - Callback when user clicks "View Logs" for a webhook
 * @returns Rendered webhook list table
 */
export function WebhookListTable({ webhooks, loading, onSelect }: Props) {
  if (loading) {
    return <p style={{ color: '#9ca3af' }}>Loading…</p>;
  }

  if (webhooks.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 10 }}>
        No webhooks configured.
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
          {['URL', 'Events', 'Status', 'Last Delivery', 'Actions'].map(h => (
            <th key={h} style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {webhooks.map((w, i) => (
          <tr key={w.webhookId} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{w.targetUrl}</td>
            <td style={{ padding: '8px 12px', fontSize: 11 }}>{w.eventTypes.join(', ')}</td>
            <td style={{ padding: '8px 12px' }}>
              <span style={{ color: w.active ? '#16a34a' : '#6b7280', fontWeight: 600, fontSize: 11 }}>
                {w.active ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 11 }}>
              {w.lastDeliveryAt ? new Date(w.lastDeliveryAt).toLocaleString() : '—'}
              {w.lastDeliverySuccess === false && (
                <span style={{ color: '#dc2626', marginLeft: 4 }}>✗</span>
              )}
            </td>
            <td style={{ padding: '8px 12px' }}>
              <button
                onClick={() => onSelect(w.webhookId)}
                style={{ padding: '3px 10px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
              >
                View Logs
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
