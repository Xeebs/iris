'use client';

import { useState, useEffect } from 'react';
import { NlpConfigChat } from '../../../../../components/nlp-config-chat';
import { IntentConfirmationDialog } from '../../../../../components/intent-confirmation-dialog';

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
  params: { workspaceId: string };
};

export default function NlpConfigPage({ params }: Props) {
  const { workspaceId } = params;
  const [intents, setIntents] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = 'current-user';

  useEffect(() => {
    fetch('/api/v1/nlp-config/intents', { headers: { 'x-workspace-id': workspaceId } })
      .then(async (r) => {
        if (!r.ok) return;
        const body = await r.json() as { data: Intent[] };
        setIntents(body.data);
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  function handleIntentSaved(intent: Intent) {
    setIntents((prev) => [intent, ...prev]);
  }

  function handleApplied(id: string) {
    setIntents((prev) => prev.filter((i) => i.id !== id));
  }

  function handleDismissed(id: string) {
    setIntents((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Natural Language Configuration</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Configure your semantic index using plain English. Iris will interpret your intent and ask for confirmation before applying any changes.
      </p>

      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Describe a change</h2>
        <NlpConfigChat workspaceId={workspaceId} onIntentSaved={handleIntentSaved} />
      </div>

      <div>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Pending changes ({intents.length})</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
          Review each change below. Apply only changes you&apos;re confident in — all changes are logged and can be investigated via audit history.
        </p>

        {loading ? (
          <div style={{ color: '#6b7280', fontSize: 13 }}>Loading pending changes…</div>
        ) : (
          <IntentConfirmationDialog
            intents={intents}
            workspaceId={workspaceId}
            userId={userId}
            onApplied={handleApplied}
            onDismissed={handleDismissed}
          />
        )}
      </div>
    </div>
  );
}
