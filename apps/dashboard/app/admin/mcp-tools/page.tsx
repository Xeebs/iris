'use client';

import { useState, useEffect, useCallback } from 'react';
import { McpToolBrowser } from '../../../components/mcp-tool-browser.js';

type ToolSummary = {
  toolName: string;
  latestVersion: string;
  totalVersions: number;
};

type ToolVersionDetail = {
  toolName: string;
  version: string;
  schemaJson: Record<string, unknown>;
  handlerRef: string;
  isActive: boolean;
  createdAt: string;
  sunsetDate: string | null;
  deprecationMessage: string | null;
};

/**
 * MCP Tools admin page — browse registered tool versions, view schemas, and generate SDK stubs.
 */
export default function McpToolsPage() {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [versions, setVersions] = useState<ToolVersionDetail[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [registerModal, setRegisterModal] = useState(false);
  const [registerForm, setRegisterForm] = useState({ toolName: '', version: '', handlerRef: '', schemaJson: '{}' });
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const API_BASE = '/api/v1/mcp-tools';

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const res = await fetch(API_BASE);
      const json = await res.json() as { data?: ToolSummary[] };
      setTools(json.data ?? []);
    } catch {
      setError('Failed to load tools');
    } finally {
      setLoadingTools(false);
    }
  }, []);

  const loadVersions = useCallback(async (toolName: string) => {
    setLoadingVersions(true);
    try {
      const res = await fetch(`${API_BASE}/${toolName}/versions`);
      const json = await res.json() as { data?: ToolVersionDetail[] };
      setVersions(json.data ?? []);
    } catch {
      setError('Failed to load versions');
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  useEffect(() => { void loadTools(); }, [loadTools]);

  const handleSelectTool = (toolName: string) => {
    setSelectedTool(toolName);
    void loadVersions(toolName);
  };

  const handleRegister = async () => {
    setRegisterError(null);
    let schemaJson: Record<string, unknown>;
    try {
      schemaJson = JSON.parse(registerForm.schemaJson) as Record<string, unknown>;
    } catch {
      setRegisterError('Schema JSON is not valid JSON');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/${registerForm.toolName}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: registerForm.version, handlerRef: registerForm.handlerRef, schemaJson }),
      });
      const json = await res.json() as { error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Registration failed');
      setRegisterModal(false);
      setRegisterForm({ toolName: '', version: '', handlerRef: '', schemaJson: '{}' });
      await loadTools();
      if (selectedTool === registerForm.toolName) await loadVersions(registerForm.toolName);
    } catch (e) {
      setRegisterError(e instanceof Error ? e.message : 'Failed to register');
    }
  };

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 1100, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>MCP Tools</h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
            Manage tool versions, view schemas, and generate typed client SDK stubs.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => void loadTools()}
            disabled={loadingTools}
            style={{ padding: '7px 14px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff', cursor: 'pointer' }}
          >
            Refresh
          </button>
          <button
            onClick={() => setRegisterModal(true)}
            style={{ padding: '7px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
          >
            Register Version
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={{ flex: 1, padding: '10px 14px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1d4ed8' }}>{tools.length}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Registered Tools</div>
        </div>
        <div style={{ flex: 1, padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>
            {tools.reduce((sum, t) => sum + t.totalVersions, 0)}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Total Versions</div>
        </div>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, minHeight: 400 }}>
        {loadingTools ? (
          <div style={{ color: '#9ca3af' }}>Loading tools…</div>
        ) : (
          <McpToolBrowser
            tools={tools}
            onSelectTool={handleSelectTool}
            selectedTool={selectedTool}
            versions={versions}
            loadingVersions={loadingVersions}
          />
        )}
      </div>

      {/* Register Version Modal */}
      {registerModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 18px' }}>Register Tool Version</h2>
            {registerError && (
              <div style={{ padding: 8, background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
                {registerError}
              </div>
            )}
            {([
              { label: 'Tool Name', key: 'toolName', placeholder: 'query-context' },
              { label: 'Version (MAJOR.MINOR)', key: 'version', placeholder: '2.0' },
              { label: 'Handler Reference', key: 'handlerRef', placeholder: 'tools/query-context.v2' },
            ] as const).map(({ label, key, placeholder }) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
                <input
                  value={registerForm[key]}
                  onChange={e => setRegisterForm(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                />
              </div>
            ))}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Schema JSON</label>
              <textarea
                value={registerForm.schemaJson}
                onChange={e => setRegisterForm(prev => ({ ...prev, schemaJson: e.target.value }))}
                rows={5}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => { setRegisterModal(false); setRegisterError(null); }}
                style={{ padding: '7px 16px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRegister()}
                style={{ padding: '7px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >
                Register
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
