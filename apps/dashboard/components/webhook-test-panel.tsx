'use client';

import { useState } from 'react';

type WebhookConfig = {
  webhookId: string;
  targetUrl: string;
};

type TestResult = {
  deliveryId: string;
  success: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  responseBody: string | null;
  errorMessage: string | null;
};

type Props = {
  webhooks: WebhookConfig[];
  selectedWebhookId: string | null;
  onSelectWebhook: (id: string | null) => void;
};

/**
 * Panel for firing manual test webhook deliveries and inspecting the response.
 * @param webhooks - Available webhooks for selection
 * @param selectedWebhookId - Currently selected webhook ID
 * @param onSelectWebhook - Callback when selection changes
 * @returns Rendered test panel with payload editor and result inspector
 */
export function WebhookTestPanel({ webhooks, selectedWebhookId, onSelectWebhook }: Props) {
  const [payload, setPayload] = useState('{\n  "event": "test",\n  "data": {}\n}');
  const [result, setResult] = useState<TestResult | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!selectedWebhookId) { setError('Select a webhook first'); return; }
    setSending(true); setResult(null); setError(null);
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const res = await fetch(`/api/v1/admin/webhooks/${selectedWebhookId}/test-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: parsed }),
      });
      const json = await res.json() as { data?: TestResult; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Test failed');
      setResult(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Webhook</label>
        <select
          value={selectedWebhookId ?? ''}
          onChange={e => onSelectWebhook(e.target.value || null)}
          style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 320 }}
        >
          <option value=''>Select a webhook…</option>
          {webhooks.map(w => (
            <option key={w.webhookId} value={w.webhookId}>{w.targetUrl}</option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Payload JSON</label>
        <textarea
          value={payload}
          onChange={e => setPayload(e.target.value)}
          rows={8}
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }}
        />
      </div>
      <button
        onClick={() => void handleSend()}
        disabled={sending || !selectedWebhookId}
        style={{ padding: '8px 20px', background: sending ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: sending ? 'not-allowed' : 'pointer' }}
      >
        {sending ? 'Sending…' : 'Send Test'}
      </button>
      {result && (
        <div style={{ marginTop: 20, border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: result.success ? '#16a34a' : '#dc2626' }}>
            {result.success ? '✓ Delivery Successful' : '✗ Delivery Failed'} · {result.latencyMs}ms · HTTP {result.statusCode}
          </div>
          {result.responseBody && (
            <pre style={{ background: '#f9fafb', padding: 10, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 200 }}>
              {result.responseBody}
            </pre>
          )}
          {result.errorMessage && (
            <div style={{ color: '#dc2626', fontSize: 12 }}>{result.errorMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
