'use client';

import { useState, useEffect, useCallback } from 'react';
import { LlmProviderSelector, type LlmProviderId } from '../../../components/llm-provider-selector.js';
import { CostProjectionCalculator } from '../../../components/cost-projection-calculator.js';

type ProviderConfig = {
  configId: string;
  providerId: string;
  modelId: string;
  costPer1mTokens: number;
  defaultForUseCase: string | null;
  endpoint: string | null;
  createdAt: string;
};

type TestResult = {
  healthy: boolean;
  latencyMs: number | null;
  response?: string;
  error?: string;
};

/**
 * Admin page for configuring LLM providers per workspace.
 * Supports registering, testing, and removing OpenAI/Anthropic/Google/Ollama providers.
 */
export default function LlmConfigurationPage() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [error, setError] = useState<string | null>(null);

  const API_BASE = '/api/v1';

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/llm-providers`);
      const json = await res.json() as { data?: ProviderConfig[]; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load providers');
      setProviders(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProviders(); }, [loadProviders]);

  const handleRegister = async (config: {
    providerId: LlmProviderId;
    modelId: string;
    apiKey: string;
    costPer1mTokens: number;
    defaultForUseCase: 'completion' | 'embedding' | undefined;
    endpoint: string | undefined;
  }) => {
    setRegistering(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/llm-providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: config.providerId,
          modelId: config.modelId,
          apiKey: config.apiKey,
          costPer1mTokens: config.costPer1mTokens,
          defaultForUseCase: config.defaultForUseCase,
          endpoint: config.endpoint,
        }),
      });
      const json = await res.json() as { error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Registration failed');
      await loadProviders();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (configId: string) => {
    try {
      await fetch(`${API_BASE}/llm-providers/${configId}`, { method: 'DELETE' });
      await loadProviders();
    } catch {
      setError('Delete failed');
    }
  };

  const handleTest = async (configId: string) => {
    setTesting(configId);
    try {
      const res = await fetch(`${API_BASE}/llm-providers/${configId}/test`, { method: 'POST' });
      const json = await res.json() as { data?: TestResult };
      setTestResults(prev => ({ ...prev, [configId]: json.data ?? { healthy: false, latencyMs: null } }));
    } catch {
      setTestResults(prev => ({ ...prev, [configId]: { healthy: false, latencyMs: null, error: 'Request failed' } }));
    } finally {
      setTesting(null);
    }
  };

  const PROVIDER_LABEL: Record<string, string> = {
    openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', ollama: 'Ollama',
  };

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>LLM Configuration</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 28 }}>
        Configure which LLM providers Iris uses for completions and embeddings. Each workspace can have a different default provider.
      </p>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Configured providers table */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Configured Providers</h3>
          <button
            onClick={() => void loadProviders()}
            disabled={loading}
            style={{ padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, background: '#fff', cursor: 'pointer' }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {providers.length === 0 ? (
          <div style={{ padding: 24, border: '2px dashed #e5e7eb', borderRadius: 8, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
            No providers configured yet. Add one below.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Provider</th>
                <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Model</th>
                <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Use Case</th>
                <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Cost/1M</th>
                <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p, i) => {
                const tr = testResults[p.configId];
                return (
                  <tr key={p.configId} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{PROVIDER_LABEL[p.providerId] ?? p.providerId}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{p.modelId}</td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{p.defaultForUseCase ?? '—'}</td>
                    <td style={{ padding: '8px 12px' }}>${p.costPer1mTokens.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {tr ? (
                        <span style={{ color: tr.healthy ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                          {tr.healthy ? `✓ ${tr.latencyMs}ms` : '✗ failed'}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => void handleTest(p.configId)}
                          disabled={testing === p.configId}
                          style={{ padding: '3px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff' }}
                        >
                          {testing === p.configId ? 'Testing…' : 'Test'}
                        </button>
                        <button
                          onClick={() => void handleDelete(p.configId)}
                          style={{ padding: '3px 10px', border: '1px solid #fca5a5', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff', color: '#dc2626' }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add provider */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Add Provider</h3>
        <LlmProviderSelector onRegister={handleRegister} registering={registering} />
      </div>

      {/* Cost projections */}
      <div>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Cost Projection</h3>
        <CostProjectionCalculator
          providers={providers.map(p => ({
            providerId: p.configId,
            providerName: PROVIDER_LABEL[p.providerId] ?? p.providerId,
            modelId: p.modelId,
            costPer1mTokens: p.costPer1mTokens,
          }))}
        />
      </div>
    </div>
  );
}
