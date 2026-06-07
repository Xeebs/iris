'use client';

import { useState } from 'react';

type SupportedVendor = 'hubspot' | 'slack';

type ValidationIssue = {
  field: string;
  message: string;
};

type ValidateResult = {
  valid: boolean;
  issues: ValidationIssue[];
  entityDeltas: number;
  vendor: SupportedVendor;
  transformedSample: string | null;
};

const PLACEHOLDER: Record<SupportedVendor, string> = {
  hubspot: JSON.stringify(
    [{ subscriptionType: 'contact.propertyChange', objectId: 12345, occurredAt: 1717000000000, propertyName: 'lifecyclestage', propertyValue: 'customer' }],
    null, 2,
  ),
  slack: JSON.stringify(
    { type: 'event_callback', event: { type: 'message', channel: 'C123', user: 'U456', text: 'Hello world', ts: '1717000000.000100' } },
    null, 2,
  ),
};

function validateLocally(vendor: SupportedVendor, rawJson: string): ValidateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { valid: false, issues: [{ field: 'body', message: 'Invalid JSON' }], entityDeltas: 0, vendor, transformedSample: null };
  }

  const issues: ValidationIssue[] = [];

  if (vendor === 'hubspot') {
    if (!Array.isArray(parsed)) {
      issues.push({ field: 'root', message: 'HubSpot payload must be a JSON array' });
    } else if (parsed.length === 0) {
      issues.push({ field: 'root', message: 'Array must contain at least one event' });
    } else {
      (parsed as unknown[]).forEach((event, i) => {
        const e = event as Record<string, unknown>;
        if (!e['subscriptionType']) issues.push({ field: `[${i}].subscriptionType`, message: 'Required' });
        if (typeof e['objectId'] !== 'number') issues.push({ field: `[${i}].objectId`, message: 'Must be a number' });
        if (typeof e['occurredAt'] !== 'number') issues.push({ field: `[${i}].occurredAt`, message: 'Must be a number' });
      });
    }
  }

  if (vendor === 'slack') {
    const p = parsed as Record<string, unknown>;
    if (!p['type']) issues.push({ field: 'type', message: 'Required' });
    if (p['type'] === 'event_callback' && !p['event']) {
      issues.push({ field: 'event', message: 'Required for event_callback type' });
    }
  }

  const valid = issues.length === 0;

  let entityDeltas = 0;
  let transformedSample: string | null = null;

  if (valid) {
    if (vendor === 'hubspot' && Array.isArray(parsed)) {
      entityDeltas = (parsed as unknown[]).filter((e) => {
        const ev = e as Record<string, unknown>;
        return ev['propertyName'] !== undefined || ev['subscriptionType'];
      }).length;
      const sample = (parsed as Record<string, unknown>[])[0];
      if (sample) {
        const type = String(sample['subscriptionType'] ?? '').includes('company')
          ? 'company' : String(sample['subscriptionType'] ?? '').includes('deal') ? 'deal' : 'contact';
        transformedSample = JSON.stringify({
          id: `hubspot:${type}:${sample['objectId']}`,
          type,
          label: `${type} ${sample['objectId']}`,
          changeType: String(sample['subscriptionType'] ?? '').includes('deletion') ? 'deleted'
            : String(sample['subscriptionType'] ?? '').includes('creation') ? 'created' : 'updated',
        }, null, 2);
      }
    }

    if (vendor === 'slack') {
      const p = parsed as Record<string, unknown>;
      const event = p['event'] as Record<string, unknown> | undefined;
      if (event?.['type'] === 'message' && event?.['ts']) {
        entityDeltas = 1;
        transformedSample = JSON.stringify({
          id: `slack:message:${event['channel']}:${event['ts']}`,
          type: 'message',
          label: String(event['text'] ?? '').slice(0, 80),
          changeType: 'created',
        }, null, 2);
      }
    }
  }

  return { valid, issues, entityDeltas, vendor, transformedSample };
}

export function WebhookValidatorPanel() {
  const [vendor, setVendor] = useState<SupportedVendor>('hubspot');
  const [rawJson, setRawJson] = useState(PLACEHOLDER['hubspot']);
  const [result, setResult] = useState<ValidateResult | null>(null);

  function handleVendorChange(v: SupportedVendor) {
    setVendor(v);
    setRawJson(PLACEHOLDER[v]);
    setResult(null);
  }

  function handleValidate() {
    setResult(validateLocally(vendor, rawJson));
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium mb-2">Vendor</p>
        <div className="flex gap-2">
          {(['hubspot', 'slack'] as SupportedVendor[]).map((v) => (
            <button
              key={v}
              onClick={() => handleVendorChange(v)}
              className={`text-xs px-3 py-1.5 rounded border ${vendor === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Webhook Payload (JSON)</p>
        <textarea
          className="w-full h-48 text-xs font-mono border rounded p-2 bg-muted resize-y"
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          placeholder="Paste your webhook payload here..."
        />
      </div>

      <button
        onClick={handleValidate}
        className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        Validate Payload
      </button>

      {result && (
        <div className="space-y-3">
          <div className={`rounded p-3 text-sm ${result.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <p className={`font-semibold ${result.valid ? 'text-green-700' : 'text-red-700'}`}>
              {result.valid ? '✓ Payload is valid' : '✗ Payload has errors'}
            </p>
            {result.valid && (
              <p className="text-green-600 text-xs mt-1">
                {result.entityDeltas} entity delta{result.entityDeltas !== 1 ? 's' : ''} would be produced
              </p>
            )}
          </div>

          {result.issues.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Validation Errors</p>
              <ul className="space-y-1">
                {result.issues.map((issue, i) => (
                  <li key={i} className="text-xs text-red-600">
                    <span className="font-mono">{issue.field}</span>: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.transformedSample && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Entity Delta Preview</p>
              <pre className="text-xs bg-muted rounded p-2 overflow-x-auto font-mono">{result.transformedSample}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
