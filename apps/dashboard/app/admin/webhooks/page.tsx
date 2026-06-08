'use client';

import { useState, useEffect, useCallback } from 'react';

type WebhookConfig = {
  webhookId: string;
  targetUrl: string;
  eventTypes: string[];
  active: boolean;
  lastDeliveryAt: string | null;
  lastDeliverySuccess: boolean | null;
};

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

type Tab = 'webhooks' | 'event-log' | 'retry-queue' | 'test';

/**
 * Webhook management admin page: list, event log, test panel, and retry queue.
 */
export default function WebhooksAdminPage() {
  const [tab, setTab] = useState<Tab>('webhooks');
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [selectedWebhook, setSelectedWebhook] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [retryQueue, setRetryQueue] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testPayload, setTestPayload] = useState('{\n  "event": "test",\n  "data": {}\n}');
  const [testResult, setTestResult] = useState<WebhookDelivery | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const API_BASE = '/api/v1';

  const loadWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/webhooks`);
      const json = await res.json() as { data?: WebhookConfig[] };
      setWebhooks(json.data ?? []);
    } catch { setError('Failed to load webhooks'); }
    finally { setLoading(false); }
  }, []);

  const loadDeliveries = useCallback(async (webhookId: string) => {
    try {
      const res = await fetch(`${API_BASE}/admin/webhooks/${webhookId}/deliveries`);
      const json = await res.json() as { data?: WebhookDelivery[] };
      setDeliveries(json.data ?? []);
    } catch { setError('Failed to load deliveries'); }
  }, []);

  const loadRetryQueue = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/webhooks/retry-queue`);
      const json = await res.json() as { data?: WebhookDelivery[] };
      setRetryQueue(json.data ?? []);
    } catch { setError('Failed to load retry queue'); }
  }, []);

  useEffect(() => { void loadWebhooks(); }, [loadWebhooks]);

  const handleSelectWebhook = (id: string) => {
    setSelectedWebhook(id);
    void loadDeliveries(id);
    setTab('event-log');
  };

  const handleTestDelivery = async () => {
    if (!selectedWebhook) { setError('Select a webhook first'); return; }
    setTesting(true); setTestResult(null); setError(null);
    try {
      const payload = JSON.parse(testPayload) as Record<string, unknown>;
      const res = await fetch(`${API_BASE}/admin/webhooks/${selectedWebhook}/test-delivery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      const json = await res.json() as { data?: WebhookDelivery; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Test failed');
      setTestResult(json.data ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Test failed'); }
    finally { setTesting(false); }
  };

  const handleRetry = async (deliveryId: string, webhookId: string) => {
    setRetrying(deliveryId);
    try {
      await fetch(`${API_BASE}/admin/webhooks/${webhookId}/retry/${deliveryId}`, { method: 'POST' });
      await loadRetryQueue();
    } catch { setError('Retry failed'); }
    finally { setRetrying(null); }
  };

  const statusBadge = (d: WebhookDelivery) => {
    const color = d.success ? '#16a34a' : '#dc2626';
    const bg = d.success ? '#f0fdf4' : '#fef2f2';
    return (
      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, color, background: bg, fontWeight: 600 }}>
        {d.success ? `${d.statusCode ?? 'OK'}` : `${d.statusCode ?? 'ERR'}`}
      </span>
    );
  };

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Webhooks</h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Manage, test, and debug webhook deliveries.</p>
        </div>
        <button onClick={() => void loadWebhooks()} style={{ padding: '7px 14px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {error && <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 20 }}>
        {([
          ['webhooks', 'Webhooks'],
          ['event-log', 'Event Log'],
          ['retry-queue', 'Retry Queue'],
          ['test', 'Test Panel'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t); if (t === 'retry-queue') void loadRetryQueue(); }}
            style={{ padding: '8px 18px', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent', color: tab === t ? '#2563eb' : '#6b7280', fontWeight: tab === t ? 700 : 400, fontSize: 14, cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Webhooks tab */}
      {tab === 'webhooks' && (
        loading ? <p style={{ color: '#9ca3af' }}>Loading…</p> : (
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
                    <span style={{ color: w.active ? '#16a34a' : '#6b7280', fontWeight: 600, fontSize: 11 }}>{w.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 11 }}>
                    {w.lastDeliveryAt ? new Date(w.lastDeliveryAt).toLocaleString() : '—'}
                    {w.lastDeliverySuccess === false && <span style={{ color: '#dc2626', marginLeft: 4 }}>✗</span>}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={() => handleSelectWebhook(w.webhookId)} style={{ padding: '3px 10px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                      View Logs
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {/* Event log tab */}
      {tab === 'event-log' && (
        <>
          {!selectedWebhook ? <p style={{ color: '#9ca3af' }}>Select a webhook from the Webhooks tab to view its event log.</p> : (
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
                    <td style={{ padding: '8px 12px' }}>{statusBadge(d)}</td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{d.latencyMs != null ? `${d.latencyMs}ms` : '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 11 }}>{new Date(d.deliveredAt).toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.errorMessage ?? d.responseBody ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Test panel */}
      {tab === 'test' && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Webhook</label>
            <select value={selectedWebhook ?? ''} onChange={e => setSelectedWebhook(e.target.value || null)}
              style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 320 }}>
              <option value=''>Select a webhook…</option>
              {webhooks.map(w => <option key={w.webhookId} value={w.webhookId}>{w.targetUrl}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Payload JSON</label>
            <textarea value={testPayload} onChange={e => setTestPayload(e.target.value)} rows={8}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }} />
          </div>
          <button onClick={() => void handleTestDelivery()} disabled={testing || !selectedWebhook}
            style={{ padding: '8px 20px', background: testing ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: testing ? 'not-allowed' : 'pointer' }}>
            {testing ? 'Sending…' : 'Send Test'}
          </button>
          {testResult && (
            <div style={{ marginTop: 20, border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: testResult.success ? '#16a34a' : '#dc2626' }}>
                {testResult.success ? '✓ Delivery Successful' : '✗ Delivery Failed'} · {testResult.latencyMs}ms · HTTP {testResult.statusCode}
              </div>
              {testResult.responseBody && (
                <pre style={{ background: '#f9fafb', padding: 10, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 200 }}>{testResult.responseBody}</pre>
              )}
              {testResult.errorMessage && <div style={{ color: '#dc2626', fontSize: 12 }}>{testResult.errorMessage}</div>}
            </div>
          )}
        </div>
      )}

      {/* Retry queue */}
      {tab === 'retry-queue' && (
        retryQueue.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 10 }}>
            No failed deliveries in the retry queue.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                {['Webhook', 'Event', 'Status', 'Retries', 'Error', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {retryQueue.map((d, i) => (
                <tr key={d.deliveryId} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>{d.webhookId}</td>
                  <td style={{ padding: '8px 12px' }}>{d.eventType}</td>
                  <td style={{ padding: '8px 12px' }}>{statusBadge(d)}</td>
                  <td style={{ padding: '8px 12px', color: '#6b7280' }}>{d.retryCount}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11, color: '#dc2626', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.errorMessage ?? '—'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={() => void handleRetry(d.deliveryId, d.webhookId)} disabled={retrying === d.deliveryId}
                      style={{ padding: '3px 10px', background: retrying === d.deliveryId ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                      {retrying === d.deliveryId ? '…' : 'Retry'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
