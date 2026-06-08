'use client';

import { useState } from 'react';

type CuratedTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  recommendedConnectors: string[];
  contextHints: string[];
};

type Props = {
  template: CuratedTemplate;
  workspaceId: string;
  onInstalled?: (templateId: string) => void;
};

const CONNECTOR_COLORS: Record<string, string> = {
  hubspot: '#ff7a59',
  salesforce: '#00a1e0',
  slack: '#4a154b',
  quickbooks: '#2ca01c',
  xero: '#1ab4d7',
  stripe: '#635bff',
  zendesk: '#03363d',
  jira: '#0052cc',
  github: '#24292e',
  linear: '#5e6ad2',
  default: '#6366f1',
};

/**
 * One-click installer card for a curated workflow template.
 * Shows connectors, context hints, and an Install button.
 *
 * @param template    - Curated template to install
 * @param workspaceId - Target workspace
 * @param onInstalled - Called with template ID after successful install
 */
export function WorkflowInstaller({ template, workspaceId, onInstalled }: Props) {
  const [state, setState] = useState<'idle' | 'installing' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleInstall() {
    setState('installing');
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/v1/workflows/curated/${template.id}/instantiate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
      });
      if (!res.ok) {
        const body = await res.json() as { error?: { message: string } };
        throw new Error(body.error?.message ?? 'Install failed');
      }
      setState('done');
      onInstalled?.(template.id);
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 10, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{template.name}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{template.description}</div>
        </div>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: '#ede9fe', color: '#6d28d9',
          fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 12,
        }}>
          {template.category}
        </span>
      </div>

      {template.recommendedConnectors.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Recommended connectors</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {template.recommendedConnectors.map((connector) => (
              <span key={connector} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                background: CONNECTOR_COLORS[connector] ?? CONNECTOR_COLORS['default'],
                color: '#fff', fontWeight: 600,
              }}>
                {connector}
              </span>
            ))}
          </div>
        </div>
      )}

      {template.contextHints.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Context includes</div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
            {template.contextHints.map((hint, i) => (
              <li key={i} style={{ fontSize: 12, color: '#374151' }}>{hint}</li>
            ))}
          </ul>
        </div>
      )}

      {state === 'error' && errorMsg && (
        <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', padding: 8, borderRadius: 4 }}>
          {errorMsg}
        </div>
      )}

      <button
        onClick={() => void handleInstall()}
        disabled={state === 'installing' || state === 'done'}
        style={{
          padding: '7px 16px', borderRadius: 6, border: 'none', cursor:
            state === 'installing' || state === 'done' ? 'default' : 'pointer',
          background: state === 'done' ? '#d1fae5' : state === 'installing' ? '#e5e7eb' : '#6366f1',
          color: state === 'done' ? '#065f46' : state === 'installing' ? '#9ca3af' : '#fff',
          fontWeight: 600, fontSize: 13, alignSelf: 'flex-start',
        }}
      >
        {state === 'done' ? 'Installed' : state === 'installing' ? 'Installing…' : 'Install'}
      </button>
    </div>
  );
}
