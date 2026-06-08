'use client';

import { useState, useEffect } from 'react';

type SsoConfig = {
  id: string;
  provider: 'saml' | 'oidc';
  providerName: string;
  enabled: boolean;
  metadataUrl: string | null;
  entityId: string | null;
  attributeMappings: Record<string, string>;
};

type SsoUser = {
  userId: string;
  externalEmail: string;
  ssoProvider: string;
  syncedGroups: string[];
  lastSyncAt: string;
};

export default function SsoAdminPage() {
  const [configs, setConfigs] = useState<SsoConfig[]>([]);
  const [users, setUsers] = useState<SsoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState('');
  const [activeTab, setActiveTab] = useState<'providers' | 'users'>('providers');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    provider: 'saml' as 'saml' | 'oidc',
    providerName: '',
    metadataUrl: '',
    entityId: '',
    enabled: false,
  });

  useEffect(() => {
    const wsId = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('workspaceId') ?? ''
      : '';
    setWorkspaceId(wsId);
    if (!wsId) { setLoading(false); return; }

    Promise.all([
      fetch('/api/v1/sso', { headers: { 'x-workspace-id': wsId } }),
      fetch('/api/v1/sso/users', { headers: { 'x-workspace-id': wsId } }),
    ]).then(async ([cfgRes, usersRes]) => {
      if (cfgRes.ok) {
        const json = await cfgRes.json() as { data: SsoConfig[] };
        setConfigs(json.data);
      }
      if (usersRes.ok) {
        const json = await usersRes.json() as { data: SsoUser[] };
        setUsers(json.data);
      }
    }).finally(() => setLoading(false));
  }, []);

  async function handleSaveProvider() {
    if (!workspaceId || !form.providerName) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/v1/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const json = await res.json() as { error: { message: string } };
        throw new Error(json.error.message);
      }
      const json = await res.json() as { data: SsoConfig };
      setConfigs((prev) => {
        const idx = prev.findIndex((c) => c.provider === json.data.provider);
        return idx >= 0 ? prev.map((c, i) => i === idx ? json.data : c) : [...prev, json.data];
      });
      setMsg({ type: 'ok', text: 'SSO provider saved' });
    } catch (e: unknown) {
      setMsg({ type: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const tabStyle = (t: string) => ({
    padding: '8px 16px', border: 'none', cursor: 'pointer',
    borderBottom: activeTab === t ? '2px solid #6366f1' : '2px solid transparent',
    background: 'none', fontWeight: activeTab === t ? 600 : 400,
    color: activeTab === t ? '#6366f1' : '#6b7280', fontSize: 13,
  });

  if (loading) return <div style={{ padding: 24, color: '#6b7280' }}>Loading SSO configuration…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Enterprise SSO</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Configure SAML 2.0 or OpenID Connect (OIDC) for enterprise identity federation.
        Users logging in via SSO are automatically provisioned (JIT provisioning).
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 24 }}>
        <button style={tabStyle('providers')} onClick={() => setActiveTab('providers')}>Providers ({configs.length})</button>
        <button style={tabStyle('users')} onClick={() => setActiveTab('users')}>Provisioned Users ({users.length})</button>
      </div>

      {activeTab === 'providers' && (
        <div>
          {configs.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              {configs.map((cfg) => (
                <div key={cfg.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{cfg.providerName}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, background: '#f3f4f6', padding: '2px 8px', borderRadius: 12, color: '#4b5563' }}>{cfg.provider.toUpperCase()}</span>
                    </div>
                    <span style={{ fontSize: 12, color: cfg.enabled ? '#16a34a' : '#9ca3af' }}>
                      {cfg.enabled ? '● Active' : '○ Disabled'}
                    </span>
                  </div>
                  {cfg.metadataUrl && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{cfg.metadataUrl}</div>}
                </div>
              ))}
            </div>
          )}

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
              {configs.length === 0 ? 'Configure SSO Provider' : 'Add / Update Provider'}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Protocol</label>
                <select
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as 'saml' | 'oidc' }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                >
                  <option value="saml">SAML 2.0</option>
                  <option value="oidc">OpenID Connect (OIDC)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Provider name</label>
                <input
                  value={form.providerName}
                  onChange={(e) => setForm((f) => ({ ...f, providerName: e.target.value }))}
                  placeholder="e.g. Okta, Azure AD, Google Workspace"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {form.provider === 'saml' ? (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Metadata URL (SAML IdP)</label>
                <input
                  value={form.metadataUrl}
                  onChange={(e) => setForm((f) => ({ ...f, metadataUrl: e.target.value }))}
                  placeholder="https://your-idp.example.com/metadata"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Entity ID / Issuer URL (OIDC)</label>
                <input
                  value={form.entityId}
                  onChange={(e) => setForm((f) => ({ ...f, entityId: e.target.value }))}
                  placeholder="https://login.microsoftonline.com/tenant-id"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <input
                type="checkbox"
                id="enabled"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              <label htmlFor="enabled" style={{ fontSize: 13 }}>Enable this SSO provider</label>
            </div>

            <div style={{ padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, color: '#1d4ed8', marginBottom: 16 }}>
              After saving, configure your IdP to use the ACS URL:{' '}
              <code style={{ fontFamily: 'monospace' }}>{`https://your-iris-instance.com/api/v1/sso/acs/${workspaceId}`}</code>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => void handleSaveProvider()}
                disabled={saving || !form.providerName}
                style={{
                  padding: '8px 20px', background: saving || !form.providerName ? '#e5e7eb' : '#6366f1',
                  color: saving || !form.providerName ? '#9ca3af' : '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                }}
              >
                {saving ? 'Saving…' : 'Save Provider'}
              </button>
              {msg && <span style={{ fontSize: 13, color: msg.type === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.text}</span>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div>
          {users.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 14 }}>No SSO-provisioned users yet. Users are automatically created on first login.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Provider</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Groups</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Last sync</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userId} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px' }}>{u.externalEmail}</td>
                    <td style={{ padding: '8px 12px' }}>{u.ssoProvider.toUpperCase()}</td>
                    <td style={{ padding: '8px 12px' }}>{u.syncedGroups.join(', ') || '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{new Date(u.lastSyncAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
