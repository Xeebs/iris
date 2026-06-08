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

type Props = {
  intents: Intent[];
  workspaceId: string;
  userId: string;
  onApplied?: (id: string) => void;
  onDismissed?: (id: string) => void;
};

const CATEGORY_BADGE: Record<string, { bg: string; color: string }> = {
  temporal:        { bg: '#e0f2fe', color: '#0369a1' },
  retention:       { bg: '#fef9c3', color: '#92400e' },
  access_control:  { bg: '#fce7f3', color: '#9d174d' },
  entity_merging:  { bg: '#f0fdf4', color: '#15803d' },
};

/**
 * Displays pending NLP configuration intents with apply/dismiss actions.
 *
 * @param intents       - Pending intents to review
 * @param workspaceId   - Current workspace
 * @param userId        - Current user (required for confirmation record)
 * @param onApplied     - Called after an intent is applied
 * @param onDismissed   - Called after an intent is dismissed
 */
export function IntentConfirmationDialog({ intents, workspaceId, userId, onApplied, onDismissed }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  if (intents.length === 0) {
    return (
      <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
        No pending configuration changes. Use the chat above to add one.
      </div>
    );
  }

  async function handleApply(id: string) {
    setLoading(id);
    try {
      const res = await fetch(`/api/v1/nlp-config/intents/${id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) onApplied?.(id);
    } finally {
      setLoading(null);
    }
  }

  async function handleDismiss(id: string) {
    setLoading(id);
    try {
      const res = await fetch(`/api/v1/nlp-config/intents/${id}`, {
        method: 'DELETE',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (res.ok) onDismissed?.(id);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {intents.map((intent) => {
        const badge = CATEGORY_BADGE[intent.category] ?? { bg: '#f3f4f6', color: '#374151' };
        const isLoading = loading === intent.id;
        return (
          <div key={intent.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 }}>
                {intent.naturalText}
              </div>
              <span style={{
                ...badge, fontSize: 11, padding: '2px 8px', borderRadius: 9999,
                fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 8,
              }}>
                {intent.category.replace(/_/g, ' ')}
              </span>
            </div>
            <pre style={{
              fontSize: 11, background: '#f9fafb', borderRadius: 4, padding: 8,
              overflow: 'auto', margin: '0 0 12px', color: '#374151',
            }}>
              {JSON.stringify(intent.interpretedConfigJson, null, 2)}
            </pre>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => void handleApply(intent.id)}
                disabled={isLoading}
                style={{
                  padding: '5px 14px', background: isLoading ? '#e5e7eb' : '#6366f1',
                  color: isLoading ? '#9ca3af' : '#fff', border: 'none', borderRadius: 6,
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}
              >
                {isLoading ? 'Working…' : 'Apply'}
              </button>
              <button
                onClick={() => void handleDismiss(intent.id)}
                disabled={isLoading}
                style={{
                  padding: '5px 14px', border: '1px solid #d1d5db', background: '#fff',
                  borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#374151',
                }}
              >
                Dismiss
              </button>
              <span style={{ fontSize: 11, color: '#9ca3af', alignSelf: 'center' }}>
                Added {new Date(intent.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
