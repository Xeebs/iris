'use client';

import { useState } from 'react';

export type LlmProviderId = 'openai' | 'anthropic' | 'google' | 'ollama';

type ProviderMeta = {
  id: LlmProviderId;
  name: string;
  defaultModel: string;
  models: string[];
  needsEndpoint: boolean;
  costRange: string;
};

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    needsEndpoint: false, costRange: '$5–15 / 1M tokens',
  },
  {
    id: 'anthropic', name: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-6',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    needsEndpoint: false, costRange: '$3–15 / 1M tokens',
  },
  {
    id: 'google', name: 'Google Gemini', defaultModel: 'gemini-1.5-pro',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
    needsEndpoint: false, costRange: '$1.25–3.5 / 1M tokens',
  },
  {
    id: 'ollama', name: 'Ollama (Local)', defaultModel: 'llama3',
    models: ['llama3', 'llama3:8b', 'gemma3:4b', 'mistral', 'phi3'],
    needsEndpoint: true, costRange: 'Free (local compute)',
  },
];

type LlmProviderSelectorProps = {
  onRegister: (config: {
    providerId: LlmProviderId;
    modelId: string;
    apiKey: string;
    costPer1mTokens: number;
    defaultForUseCase: 'completion' | 'embedding' | undefined;
    endpoint: string | undefined;
  }) => Promise<void>;
  registering?: boolean;
};

/**
 * Form for adding a new LLM provider configuration.
 * Supports OpenAI, Anthropic, Google, and Ollama.
 */
export function LlmProviderSelector({ onRegister, registering = false }: LlmProviderSelectorProps) {
  const [selectedProvider, setSelectedProvider] = useState<LlmProviderId>('openai');
  const [modelId, setModelId] = useState('gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [costPer1mTokens, setCostPer1mTokens] = useState(5);
  const [useCase, setUseCase] = useState<'completion' | 'embedding'>('completion');
  const [endpoint, setEndpoint] = useState('http://localhost:11434');

  const meta = PROVIDERS.find(p => p.id === selectedProvider)!;

  const handleProviderChange = (id: LlmProviderId) => {
    setSelectedProvider(id);
    const m = PROVIDERS.find(p => p.id === id)!;
    setModelId(m.defaultModel);
  };

  const handleSubmit = async () => {
    await onRegister({
      providerId: selectedProvider,
      modelId,
      apiKey,
      costPer1mTokens,
      defaultForUseCase: useCase,
      endpoint: meta.needsEndpoint ? endpoint : undefined,
    });
    setApiKey('');
  };

  return (
    <div style={{ padding: '16px 20px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fafafa' }}>
      <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>Add LLM Provider</h4>

      {/* Provider pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            onClick={() => handleProviderChange(p.id)}
            style={{
              padding: '5px 14px',
              border: `1px solid ${selectedProvider === p.id ? '#2563eb' : '#d1d5db'}`,
              borderRadius: 20,
              background: selectedProvider === p.id ? '#eff6ff' : '#fff',
              color: selectedProvider === p.id ? '#1d4ed8' : '#374151',
              fontWeight: selectedProvider === p.id ? 700 : 400,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        {/* Model selector */}
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Model</label>
          <select
            value={modelId}
            onChange={e => setModelId(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          >
            {meta.models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Default use case */}
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Default For</label>
          <select
            value={useCase}
            onChange={e => setUseCase(e.target.value as 'completion' | 'embedding')}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          >
            <option value="completion">Completion</option>
            <option value="embedding">Embedding</option>
          </select>
        </div>
      </div>

      {/* API key */}
      {!meta.needsEndpoint && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={`Enter ${meta.name} API key`}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
      )}

      {/* Ollama endpoint */}
      {meta.needsEndpoint && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Ollama Endpoint</label>
          <input
            type="text"
            value={endpoint}
            onChange={e => setEndpoint(e.target.value)}
            placeholder="http://localhost:11434"
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
      )}

      {/* Cost */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
          Cost / 1M tokens (USD) — <em style={{ color: '#9ca3af' }}>{meta.costRange}</em>
        </label>
        <input
          type="number"
          min={0}
          step={0.1}
          value={costPer1mTokens}
          onChange={e => setCostPer1mTokens(Number(e.target.value))}
          style={{ width: 140, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        />
      </div>

      <button
        onClick={() => void handleSubmit()}
        disabled={registering || (!meta.needsEndpoint && !apiKey)}
        style={{
          padding: '8px 20px',
          background: registering || (!meta.needsEndpoint && !apiKey) ? '#9ca3af' : '#2563eb',
          color: '#fff', border: 'none', borderRadius: 6, fontSize: 13,
          cursor: registering ? 'not-allowed' : 'pointer',
        }}
      >
        {registering ? 'Saving…' : 'Save Provider'}
      </button>
    </div>
  );
}
