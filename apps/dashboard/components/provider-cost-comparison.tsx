'use client';

import { useState } from 'react';

type LlmProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'mistral' | 'cohere';

interface CostEstimate {
  providerId: LlmProviderId;
  providerName: string;
  inputTokens: number;
  outputTokensEstimate: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  embeddingCostUsd: number;
  embeddingModelId: string | null;
}

interface ProviderCostComparisonProps {
  workspaceId?: string;
}

/**
 * Interactive cost comparison tool for all LLM providers given a sample query size.
 */
export function ProviderCostComparison({ workspaceId }: ProviderCostComparisonProps) {
  const [inputTokens, setInputTokens] = useState(2000);
  const [outputTokens, setOutputTokens] = useState(500);
  const [embeddingTokens, setEmbeddingTokens] = useState(100);
  const [estimates, setEstimates] = useState<CostEstimate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runEstimate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/providers/estimate-cost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
        },
        body: JSON.stringify({ inputTokens, outputTokensEstimate: outputTokens, embeddingTokens }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = (await res.json()) as { data: CostEstimate[] };
      setEstimates(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Estimate failed');
    } finally {
      setLoading(false);
    }
  };

  const maxCost = Math.max(...estimates.map((e) => e.totalCostUsd), 0.001);

  const formatCost = (usd: number) =>
    usd === 0 ? 'Free' : usd < 0.001 ? `<$0.001` : `$${usd.toFixed(4)}`;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-gray-800">Provider Cost Comparison</h3>
        <p className="text-xs text-gray-500 mt-0.5">Estimate costs per request across all LLM providers</p>
      </div>

      {/* Input controls */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Input tokens', value: inputTokens, set: setInputTokens },
          { label: 'Output tokens (est.)', value: outputTokens, set: setOutputTokens },
          { label: 'Embedding tokens', value: embeddingTokens, set: setEmbeddingTokens },
        ].map(({ label, value, set }) => (
          <div key={label}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
            <input
              type="number"
              min={0}
              value={value}
              onChange={(e) => set(parseInt(e.target.value, 10) || 0)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void runEstimate()}
        disabled={loading}
        className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Calculating…' : 'Compare Costs'}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {estimates.length > 0 && (
        <div className="space-y-2.5">
          {estimates.map((est, i) => (
            <div key={est.providerId} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {i === 0 && (
                    <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">Cheapest</span>
                  )}
                  <span className="font-medium text-gray-800">{est.providerName}</span>
                  {est.embeddingModelId && (
                    <span className="text-xs text-gray-400">({est.embeddingModelId})</span>
                  )}
                </div>
                <span className={`font-semibold ${est.totalCostUsd === 0 ? 'text-green-600' : 'text-gray-700'}`}>
                  {formatCost(est.totalCostUsd)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-100">
                <div
                  className={`h-2 rounded-full transition-all ${i === 0 ? 'bg-green-500' : 'bg-indigo-400'}`}
                  style={{ width: `${Math.max((est.totalCostUsd / maxCost) * 100, est.totalCostUsd === 0 ? 1 : 0)}%` }}
                />
              </div>
              {(est.embeddingCostUsd > 0) && (
                <p className="text-xs text-gray-400">
                  In: {formatCost(est.inputCostUsd)} · Out: {formatCost(est.outputCostUsd)} · Embed: {formatCost(est.embeddingCostUsd)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
