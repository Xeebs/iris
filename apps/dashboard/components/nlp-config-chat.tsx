'use client';

import { useState } from 'react';

type Intent = {
  id: string;
  category: string;
  naturalText: string;
  interpretedConfigJson: Record<string, unknown>;
  confirmedByUserId: string | null;
  appliedAt: string | null;
  createdAt: string;
};

type ParsedIntent = {
  category: string;
  payload: Record<string, unknown>;
  summary: string;
  confidence: number;
  rawInput: string;
};

type Props = {
  workspaceId: string;
  onIntentSaved?: (intent: Intent) => void;
};

const EXAMPLES = [
  'Our fiscal year starts in February',
  'Archive contacts older than 6 months',
  'Hide SSN from finance viewers',
  'Contacts and people are the same',
];

/**
 * Chat-style input for natural language index configuration.
 * Shows a preview of the interpreted intent before saving.
 *
 * @param workspaceId   - Current workspace
 * @param onIntentSaved - Called after a pending intent is persisted
 */
export function NlpConfigChat({ workspaceId, onIntentSaved }: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsedIntent | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handlePreview() {
    if (!text.trim()) return;
    setLoading(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const res = await fetch('/api/v1/nlp-config/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ text }),
      });
      const body = await res.json() as { data?: { intent: ParsedIntent }; error?: { message: string } };
      if (!res.ok) { setPreviewError(body.error?.message ?? 'Could not parse intent'); return; }
      setPreview(body.data!.intent);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!preview) return;
    setSaving(true);
    try {
      const res = await fetch('/api/v1/nlp-config/intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ text }),
      });
      const body = await res.json() as { data?: Intent };
      if (res.ok && body.data) {
        onIntentSaved?.(body.data);
        setText('');
        setPreview(null);
      }
    } finally {
      setSaving(false);
    }
  }

  const confidenceColor = (preview?.confidence ?? 0) >= 0.9 ? '#15803d' : (preview?.confidence ?? 0) >= 0.7 ? '#92400e' : '#b91c1c';

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setText(ex)}
              style={{
                padding: '3px 10px', fontSize: 12, border: '1px solid #d1d5db',
                borderRadius: 9999, background: '#f9fafb', cursor: 'pointer', color: '#374151',
              }}
            >
              {ex}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); setPreviewError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handlePreview(); }}
            placeholder="e.g. Our fiscal year starts in February"
            style={{
              flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6,
              fontSize: 14, outline: 'none',
            }}
          />
          <button
            onClick={() => void handlePreview()}
            disabled={!text.trim() || loading}
            style={{
              padding: '8px 16px', background: !text.trim() || loading ? '#e5e7eb' : '#6366f1',
              color: !text.trim() || loading ? '#9ca3af' : '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            {loading ? 'Parsing…' : 'Parse'}
          </button>
        </div>
      </div>

      {previewError && (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#b91c1c', marginBottom: 12 }}>
          {previewError}
        </div>
      )}

      {preview && (
        <div style={{ border: '1px solid #e0e7ff', borderRadius: 8, padding: 16, background: '#f5f3ff', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#4338ca' }}>{preview.summary}</div>
            <span style={{ fontSize: 11, color: confidenceColor, fontWeight: 600 }}>
              {Math.round(preview.confidence * 100)}% confidence
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            Category: <strong>{preview.category.replace(/_/g, ' ')}</strong>
          </div>
          <pre style={{ fontSize: 11, background: '#ede9fe', borderRadius: 4, padding: 8, overflow: 'auto', margin: '0 0 12px' }}>
            {JSON.stringify(preview.payload, null, 2)}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                padding: '6px 16px', background: saving ? '#e5e7eb' : '#6366f1',
                color: saving ? '#9ca3af' : '#fff', border: 'none', borderRadius: 6,
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}
            >
              {saving ? 'Saving…' : 'Add to Queue'}
            </button>
            <button
              onClick={() => { setPreview(null); setPreviewError(null); }}
              style={{ padding: '6px 16px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
