'use client';

import { useState, useEffect, useCallback } from 'react';

type LlmProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'mistral' | 'cohere';

interface ProviderSpec {
  id: LlmProviderId;
  name: string;
  contextWindowTokens: number;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  supportsStreaming: boolean;
  supportsPrefixCache: boolean;
  preferredSerializationFormat: string;
  embeddingModelId: string | null;
}

interface WorkspaceProviderConfig {
  providerId: LlmProviderId;
  priority: number;
  isEnabled: boolean;
}

interface ProviderConfigProps {
  workspaceId: string;
}

const PROVIDER_LOGOS: Record<LlmProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  ollama: 'Ollama',
  mistral: 'Mistral',
  cohere: 'Cohere',
};

/**
 * Admin panel for configuring LLM providers per workspace, with priority ordering
 * and cost comparison tools.
 */
export function ProviderConfig({ workspaceId }: ProviderConfigProps) {
  const [registry, setRegistry] = useState<ProviderSpec[]>([]);
  const [configs, setConfigs] = useState<WorkspaceProviderConfig[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [regRes, cfgRes] = await Promise.all([
        fetch('/api/v1/providers/registry'),
        fetch('/api/v1/providers', { headers: { 'x-workspace-id': workspaceId } }),
      ]);
      if (regRes.ok) {
        const regJson = (await regRes.json()) as { data: ProviderSpec[] };
        setRegistry(regJson.data);
      }
      if (cfgRes.ok) {
        const cfgJson = (await cfgRes.json()) as { data: WorkspaceProviderConfig[] };
        setConfigs(cfgJson.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  }, [workspaceId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const getConfig = (id: LlmProviderId): WorkspaceProviderConfig =>
    configs.find((c) => c.providerId === id) ?? { providerId: id, priority: 99, isEnabled: false };

  const handleToggle = async (id: LlmProviderId, isEnabled: boolean) => {
    setSaving(id);
    const current = getConfig(id);
    try {
      const res = await fetch(`/api/v1/providers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'x-workspace-id': workspaceId, 'content-type': 'application/json' },
        body: JSON.stringify({ priority: current.priority, isEnabled }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  };

  const handlePriorityChange = async (id: LlmProviderId, priority: number) => {
    setSaving(id);
    const current = getConfig(id);
    try {
      await fetch(`/api/v1/providers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'x-workspace-id': workspaceId, 'content-type': 'application/json' },
        body: JSON.stringify({ priority, isEnabled: current.isEnabled }),
      });
      await fetchData();
    } catch {
      setError('Priority update failed');
    } finally {
      setSaving(null);
    }
  };

  const enabledProviders = registry.filter((p) => getConfig(p.id).isEnabled)
    .sort((a, b) => getConfig(a.id).priority - getConfig(b.id).priority);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-800">LLM Providers</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Configure which AI providers are available for this workspace. Priority 1 = first choice.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {enabledProviders.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Active (Ordered by Priority)</h4>
          <div className="space-y-1.5">
            {enabledProviders.map((spec, i) => (
              <div key={spec.id} className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
                <span className="w-5 shrink-0 text-center text-xs font-bold text-indigo-500">{i + 1}</span>
                <span className="flex-1 text-sm font-medium text-indigo-800">{PROVIDER_LOGOS[spec.id]}</span>
                <span className="text-xs text-indigo-600">{(spec.contextWindowTokens / 1000).toFixed(0)}K ctx</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">All Providers</h4>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {registry.map((spec) => {
            const cfg = getConfig(spec.id);
            const isSaving = saving === spec.id;
            return (
              <div key={spec.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{spec.name}</p>
                  <p className="text-xs text-gray-500">
                    {(spec.contextWindowTokens / 1000).toFixed(0)}K tokens · ${spec.inputCostPer1kTokens}/1K in · ${spec.outputCostPer1kTokens}/1K out
                    {spec.supportsPrefixCache && ' · prefix cache'}
                  </p>
                </div>

                {cfg.isEnabled && (
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={cfg.priority}
                    disabled={isSaving}
                    className="w-14 rounded border border-gray-200 px-2 py-0.5 text-center text-sm"
                    onChange={(e) => void handlePriorityChange(spec.id, parseInt(e.target.value, 10) || 1)}
                    title="Priority (lower = higher priority)"
                  />
                )}

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfg.isEnabled}
                    disabled={isSaving}
                    className="rounded"
                    onChange={(e) => void handleToggle(spec.id, e.target.checked)}
                  />
                  <span className="text-xs text-gray-600">{cfg.isEnabled ? 'On' : 'Off'}</span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
