'use client';

import { useEffect, useState } from 'react';

type Language = 'typescript' | 'python' | 'go';

type LanguageInfo = {
  language: Language;
  label: string;
  extension: string;
  packageManager: string;
};

type GenerationResult = {
  jobId: string;
  language: Language;
  status: string;
  downloadUrl: string;
  toolCount: number;
  methods: string[];
  docsSummary: string;
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type PreviewData = {
  code: string;
  methods: string[];
  docsMarkdown: string;
};

const LANGUAGE_CONFIGS: Record<Language, { installCmd: string; importExample: string; quickStart: string }> = {
  typescript: {
    installCmd: 'npm install @iris/client-sdk',
    importExample: "import { IrisClient } from '@iris/client-sdk';",
    quickStart: `const client = new IrisClient(process.env.IRIS_API_KEY!);
const result = await client.queryContext({ query: 'top deals this month' });
console.log(result);`,
  },
  python: {
    installCmd: 'pip install iris-client-sdk',
    importExample: 'from iris_sdk import IrisClient',
    quickStart: `client = IrisClient(api_key=os.environ["IRIS_API_KEY"])
result = client.query_context(QueryContextRequest(query="top deals this month"))
print(result)`,
  },
  go: {
    installCmd: 'go get github.com/iris-mcp/go-sdk',
    importExample: 'import "github.com/iris-mcp/go-sdk/iris"',
    quickStart: `client := iris.NewIrisClient(os.Getenv("IRIS_API_KEY"))
resp, err := client.QueryContext(ctx, iris.QueryContextRequest{Query: "top deals this month"})
if err != nil { log.Fatal(err) }
fmt.Println(resp)`,
  },
};

export default function SdkPortalPage() {
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [selectedLang, setSelectedLang] = useState<Language>('typescript');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [activeTab, setActiveTab] = useState<'download' | 'preview' | 'reference'>('download');

  useEffect(() => {
    void fetchLanguages();
    void fetchTools();
  }, []);

  useEffect(() => {
    void fetchPreview();
  }, [selectedLang]);

  async function fetchLanguages() {
    try {
      const res = await fetch('/api/v1/sdks/languages');
      if (res.ok) {
        const body = (await res.json()) as { data: LanguageInfo[] };
        setLanguages(body.data ?? []);
      }
    } catch { /* ignore */ }
  }

  async function fetchTools() {
    try {
      const res = await fetch('/api/v1/sdks/tools');
      if (res.ok) {
        const body = (await res.json()) as { data: ToolDef[] };
        setTools(body.data ?? []);
      }
    } catch { /* ignore */ }
  }

  async function fetchPreview() {
    try {
      const res = await fetch(`/api/v1/sdks/preview/${selectedLang}`);
      if (res.ok) {
        const body = (await res.json()) as { data: PreviewData };
        setPreview(body.data);
      }
    } catch { /* ignore */ }
  }

  async function generateSdk() {
    setGenerating(true);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/sdks/generate/${selectedLang}`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'default', version: '0.1.0' }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const body = (await res.json()) as { data: GenerationResult };
        setResult(body.data);
      }
    } catch { /* ignore */ }
    finally { setGenerating(false); }
  }

  const cfg = LANGUAGE_CONFIGS[selectedLang];

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', maxWidth: 960 }}>
      <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem', fontWeight: 700 }}>Developer Portal</h1>
      <p style={{ color: '#6b7280', marginTop: 0, fontSize: '0.875rem' }}>
        Auto-generated type-safe client SDKs for the Iris MCP server.
      </p>

      {/* Language selector */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {(languages.length > 0 ? languages : [{ language: 'typescript' as Language, label: 'TypeScript' }, { language: 'python' as Language, label: 'Python' }, { language: 'go' as Language, label: 'Go' }]).map((l) => (
          <button
            key={l.language}
            onClick={() => setSelectedLang(l.language)}
            style={{
              padding: '0.4rem 1rem', border: `1px solid ${selectedLang === l.language ? '#3b82f6' : '#d1d5db'}`,
              borderRadius: 6, background: selectedLang === l.language ? '#eff6ff' : '#fff',
              color: selectedLang === l.language ? '#3b82f6' : '#374151',
              cursor: 'pointer', fontWeight: selectedLang === l.language ? 600 : 400, fontSize: '0.875rem',
            }}
          >
            {l.label ?? l.language}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e5e7eb', marginBottom: '1.25rem' }}>
        {([['download', 'Download SDK'], ['preview', 'Code Preview'], ['reference', 'API Reference']] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.4rem 0.875rem', border: 'none', background: 'transparent', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab ? '#3b82f6' : '#6b7280',
              fontWeight: activeTab === tab ? 600 : 400, fontSize: '0.875rem', marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'download' && (
        <div>
          {/* Quick-start */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 600 }}>Quick Start</h3>
            <p style={{ fontSize: '0.8125rem', color: '#6b7280', margin: '0 0 0.5rem' }}>Install:</p>
            <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 4, padding: '0.6rem 0.875rem', fontSize: '0.8125rem', margin: '0 0 0.75rem', overflowX: 'auto' }}>
              {cfg.installCmd}
            </pre>
            <p style={{ fontSize: '0.8125rem', color: '#6b7280', margin: '0 0 0.5rem' }}>Import:</p>
            <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 4, padding: '0.6rem 0.875rem', fontSize: '0.8125rem', margin: '0 0 0.75rem', overflowX: 'auto' }}>
              {cfg.importExample}
            </pre>
            <p style={{ fontSize: '0.8125rem', color: '#6b7280', margin: '0 0 0.5rem' }}>Usage:</p>
            <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 4, padding: '0.6rem 0.875rem', fontSize: '0.8125rem', margin: 0, overflowX: 'auto' }}>
              {cfg.quickStart}
            </pre>
          </div>

          {/* Generate button */}
          <button
            onClick={() => void generateSdk()}
            disabled={generating}
            style={{ padding: '0.5rem 1.25rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
          >
            {generating ? 'Generating…' : `Generate ${selectedLang.toUpperCase()} SDK`}
          </button>

          {result && (
            <div style={{ marginTop: '1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '0.875rem' }}>
              <p style={{ margin: '0 0 0.4rem', fontWeight: 600, color: '#166534', fontSize: '0.875rem' }}>
                SDK generated — {result.toolCount} tools, {result.methods.length} methods
              </p>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: '#374151' }}>
                Download URL: <code style={{ fontFamily: 'monospace' }}>{result.downloadUrl}</code>
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'preview' && (
        <div>
          <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 6, padding: '1rem', fontSize: '0.75rem', overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
            {preview?.code ?? 'Loading preview…'}
          </pre>
        </div>
      )}

      {activeTab === 'reference' && (
        <div>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem', fontWeight: 600 }}>Available Tools</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {tools.map((tool) => (
              <div key={tool.name} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.875rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <code style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.875rem', color: '#1d4ed8', background: '#eff6ff', padding: '0.15rem 0.4rem', borderRadius: 3 }}>
                    {tool.name}
                  </code>
                </div>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#374151' }}>{tool.description}</p>
                {tool.inputSchema['properties'] && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
                    Parameters: {Object.keys(tool.inputSchema['properties'] as object).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
