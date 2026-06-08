'use client';

type PayloadDiff = {
  field: string;
  expected: unknown;
  actual: unknown;
  matches: boolean;
};

type SignatureValidation = {
  valid: boolean;
  expectedSignature: string;
  actualSignature: string;
  algorithm: string;
};

type Props = {
  requestBody: string;
  responseBody: string | null;
  signatureValidation?: SignatureValidation;
  payloadDiffs?: PayloadDiff[];
};

function DiffRow({ diff }: { diff: PayloadDiff }) {
  const bg = diff.matches ? '#f0fdf4' : '#fef2f2';
  const color = diff.matches ? '#16a34a' : '#dc2626';
  return (
    <tr style={{ background: bg }}>
      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{diff.field}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'monospace', color: '#374151' }}>
        {JSON.stringify(diff.expected)}
      </td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'monospace', color: '#374151' }}>
        {JSON.stringify(diff.actual)}
      </td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color }}>{diff.matches ? '✓' : '✗'}</td>
    </tr>
  );
}

/**
 * Debug panel showing request/response bodies, payload diff, and signature validation for a delivery.
 * @param requestBody - Raw request payload sent to the webhook endpoint
 * @param responseBody - Raw response body received from the endpoint
 * @param signatureValidation - HMAC-SHA256 signature validation result, if available
 * @param payloadDiffs - Field-level diff between expected and actual payload, if available
 * @returns Rendered debug panel with request/response and validation details
 */
export function WebhookDebuggerPanel({ requestBody, responseBody, signatureValidation, payloadDiffs }: Props) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#374151' }}>Request Body</div>
          <pre style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, fontSize: 11, overflow: 'auto', maxHeight: 200, margin: 0 }}>
            {requestBody}
          </pre>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#374151' }}>Response Body</div>
          <pre style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, fontSize: 11, overflow: 'auto', maxHeight: 200, margin: 0 }}>
            {responseBody ?? '(no response)'}
          </pre>
        </div>
      </div>

      {signatureValidation && (
        <div style={{ marginBottom: 20, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Signature Validation</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, color: signatureValidation.valid ? '#16a34a' : '#dc2626' }}>
              {signatureValidation.valid ? '✓ Valid' : '✗ Invalid'}
            </span>
            <span style={{ fontSize: 11, color: '#6b7280' }}>{signatureValidation.algorithm}</span>
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#374151' }}>
            <div><span style={{ color: '#6b7280' }}>Expected: </span>{signatureValidation.expectedSignature.slice(0, 32)}…</div>
            <div><span style={{ color: '#6b7280' }}>Received: </span>{signatureValidation.actualSignature.slice(0, 32) || '(empty)'}…</div>
          </div>
        </div>
      )}

      {payloadDiffs && payloadDiffs.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Payload Diff</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                {['Field', 'Expected', 'Actual', 'Match'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payloadDiffs.map(diff => <DiffRow key={diff.field} diff={diff} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
