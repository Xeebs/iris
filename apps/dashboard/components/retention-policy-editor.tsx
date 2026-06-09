'use client';

import { useState } from 'react';

type RetentionPolicy = {
  policyId?: string;
  connectorId: string;
  entityType: string;
  ttlDays: number;
  isActive: boolean;
};

type RetentionPolicyEditorProps = {
  policies: RetentionPolicy[];
  connectors?: string[];
  entityTypes?: string[];
  onSave: (policy: Omit<RetentionPolicy, 'policyId'>) => Promise<void>;
  onToggle?: (policyId: string, isActive: boolean) => Promise<void>;
};

const DEFAULT_CONNECTORS = ['hubspot', 'salesforce', 'notion', 'github', 'jira'];
const DEFAULT_ENTITY_TYPES = ['contact', 'deal', 'company', 'activity', 'ticket'];

export function RetentionPolicyEditor({
  policies,
  connectors = DEFAULT_CONNECTORS,
  entityTypes = DEFAULT_ENTITY_TYPES,
  onSave,
  onToggle,
}: RetentionPolicyEditorProps) {
  const [connectorId, setConnectorId] = useState(connectors[0] ?? '');
  const [entityType, setEntityType] = useState(entityTypes[0] ?? '');
  const [ttlDays, setTtlDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!connectorId || !entityType || ttlDays <= 0) {
      setError('All fields are required and TTL must be positive.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ connectorId, entityType, ttlDays, isActive: true });
    } catch {
      setError('Failed to save policy.');
    } finally {
      setSaving(false);
    }
  }

  const selectStyle = { padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem' };

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      {/* New policy form */}
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>Add / Update Policy</h3>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem', color: '#374151' }}>
            Connector
            <select value={connectorId} onChange={(e) => setConnectorId(e.target.value)} style={selectStyle}>
              {connectors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem', color: '#374151' }}>
            Entity Type
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={selectStyle}>
              {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem', color: '#374151' }}>
            TTL (days)
            <input
              type="number"
              min={1}
              max={3650}
              value={ttlDays}
              onChange={(e) => setTtlDays(parseInt(e.target.value, 10) || 1)}
              style={{ ...selectStyle, width: 80 }}
            />
          </label>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            style={{ padding: '0.4rem 0.9rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', alignSelf: 'flex-end' }}
          >
            {saving ? 'Saving…' : 'Save Policy'}
          </button>
        </div>
        {error && <p style={{ color: '#ef4444', fontSize: '0.8125rem', marginTop: '0.5rem' }}>{error}</p>}
      </div>

      {/* Existing policies */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {['Connector', 'Entity Type', 'TTL (days)', 'Status', ''].map((h) => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                  No retention policies configured yet.
                </td>
              </tr>
            ) : (
              policies.map((p, i) => (
                <tr key={p.policyId ?? i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500, color: '#111827' }}>{p.connectorId}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>{p.entityType}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>{p.ttlDays}d</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 500, background: p.isActive ? '#dcfce7' : '#f3f4f6', color: p.isActive ? '#166534' : '#6b7280' }}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    {onToggle && p.policyId && (
                      <button
                        onClick={() => void onToggle(p.policyId!, !p.isActive)}
                        style={{ padding: '0.2rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.75rem', color: '#374151' }}
                      >
                        {p.isActive ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
