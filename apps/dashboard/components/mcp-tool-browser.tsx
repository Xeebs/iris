'use client';

import { useState } from 'react';

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

type SdkStub = {
  toolName: string;
  version: string;
  language: 'typescript' | 'python';
  code: string;
};

type McpToolBrowserProps = {
  tools: ToolSummary[];
  onSelectTool: (toolName: string) => void;
  selectedTool: string | null;
  versions: ToolVersionDetail[];
  loadingVersions: boolean;
};

/**
 * Side-panel tool browser listing all registered MCP tools with version info.
 */
export function McpToolBrowser({ tools, onSelectTool, selectedTool, versions, loadingVersions }: McpToolBrowserProps) {
  const [sdkStub, setSdkStub] = useState<SdkStub | null>(null);
  const [stubLang, setStubLang] = useState<'typescript' | 'python'>('typescript');

  const fetchSdkStub = async (toolName: string, version: string) => {
    const res = await fetch(`/api/v1/mcp-tools/${toolName}/sdk-stub?language=${stubLang}&version=${version}`);
    const json = await res.json() as { data?: SdkStub };
    setSdkStub(json.data ?? null);
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', fontSize: 13 }}>
      {/* Tool list */}
      <div style={{ width: 220, borderRight: '1px solid #e5e7eb', paddingRight: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, color: '#374151' }}>MCP Tools</div>
        {tools.length === 0 && <div style={{ color: '#9ca3af' }}>No tools registered.</div>}
        {tools.map(t => (
          <button
            key={t.toolName}
            onClick={() => onSelectTool(t.toolName)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
              background: selectedTool === t.toolName ? '#eff6ff' : 'none',
              border: selectedTool === t.toolName ? '1px solid #bfdbfe' : '1px solid transparent',
              borderRadius: 6, cursor: 'pointer', marginBottom: 4,
            }}
          >
            <div style={{ fontWeight: 600, color: '#1d4ed8' }}>{t.toolName}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              v{t.latestVersion} · {t.totalVersions} version{t.totalVersions !== 1 ? 's' : ''}
            </div>
          </button>
        ))}
      </div>

      {/* Version detail */}
      <div style={{ flex: 1 }}>
        {!selectedTool ? (
          <div style={{ padding: 24, color: '#9ca3af', textAlign: 'center' }}>
            Select a tool to view versions and schema.
          </div>
        ) : loadingVersions ? (
          <div style={{ color: '#9ca3af' }}>Loading…</div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{selectedTool}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => setStubLang('typescript')}
                style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 11, cursor: 'pointer', background: stubLang === 'typescript' ? '#eff6ff' : '#fff', fontWeight: stubLang === 'typescript' ? 700 : 400, color: stubLang === 'typescript' ? '#1d4ed8' : '#374151' }}
              >
                TypeScript
              </button>
              <button
                onClick={() => setStubLang('python')}
                style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 11, cursor: 'pointer', background: stubLang === 'python' ? '#eff6ff' : '#fff', fontWeight: stubLang === 'python' ? 700 : 400, color: stubLang === 'python' ? '#1d4ed8' : '#374151' }}
              >
                Python
              </button>
            </div>

            {versions.map(v => (
              <div key={v.version} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>v{v.version}</span>
                    {v.sunsetDate && (
                      <span style={{ padding: '1px 8px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 10, fontSize: 11, color: '#92400e' }}>
                        Deprecated · sunset {new Date(v.sunsetDate).toLocaleDateString()}
                      </span>
                    )}
                    {!v.isActive && (
                      <span style={{ padding: '1px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 10, fontSize: 11, color: '#6b7280' }}>
                        Inactive
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => void fetchSdkStub(v.toolName, v.version)}
                    style={{ padding: '3px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
                  >
                    Generate {stubLang === 'typescript' ? 'TS' : 'Py'} Stub
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
                  Handler: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{v.handlerRef}</code>
                </div>
                {v.deprecationMessage && (
                  <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>{v.deprecationMessage}</div>
                )}
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: 11 }}>Schema JSON</summary>
                  <pre style={{ marginTop: 6, padding: 10, background: '#f9fafb', borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 200 }}>
                    {JSON.stringify(v.schemaJson, null, 2)}
                  </pre>
                </details>
              </div>
            ))}

            {sdkStub && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>SDK Stub — v{sdkStub.version} ({sdkStub.language})</div>
                <pre style={{ padding: 14, background: '#1e1e2e', color: '#cdd6f4', borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 300 }}>
                  {sdkStub.code}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
