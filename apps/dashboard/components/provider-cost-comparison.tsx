'use client';

import { useState } from 'react';

type Provider = 'anthropic' | 'openai' | 'azure' | 'gemini';

type ProviderEstimate = {
  provider: Provider;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostCents: number;
  estimatedLatencyMs: number;
};

type ProviderValueScore = {
  provider: Provider;
  costScore: number;
  speedScore: number;
  accuracyScore: number;
  valueScore: number;
};

type CostComparisonData = {
  allEstimates: ProviderEstimate[];
  ranked: ProviderValueScore[];
  optimal: { provider: Provider; rationale: string };
};

const PROVIDER_COLORS: Record<Provider, string> = {
  anthropic: '#CC785C',
  openai: '#10a37f',
  azure: '#0078d4',
  gemini: '#4285f4',
};

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT',
  azure: 'Azure OpenAI',
  gemini: 'Google Gemini',
};

export default function ProviderCostComparison({ data }: { data: CostComparisonData }) {
  const [tab, setTab] = useState<'cost' | 'value'>('value');

  const maxCost = Math.max(...data.allEstimates.map(e => e.estimatedCostCents), 0.001);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Provider Comparison</h3>
        <div className="flex rounded-md border border-gray-200">
          {(['value', 'cost'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                tab === t ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              } first:rounded-l-md last:rounded-r-md`}
            >
              {t === 'value' ? 'Value Score' : 'Cost'}
            </button>
          ))}
        </div>
      </div>

      {data.optimal && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-100 px-3 py-2 text-xs text-green-800">
          <span className="font-medium">Optimal: {PROVIDER_LABELS[data.optimal.provider]}</span>
          {' — '}{data.optimal.rationale}
        </div>
      )}

      {tab === 'value' ? (
        <div className="space-y-3">
          {data.ranked.map(r => (
            <div key={r.provider}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700">{PROVIDER_LABELS[r.provider]}</span>
                <span className="text-gray-500">{(r.valueScore * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{ width: `${r.valueScore * 100}%`, backgroundColor: PROVIDER_COLORS[r.provider] }}
                />
              </div>
              <div className="mt-1 flex gap-3 text-[10px] text-gray-400">
                <span>Accuracy {(r.accuracyScore * 100).toFixed(0)}%</span>
                <span>Cost {(r.costScore * 100).toFixed(0)}%</span>
                <span>Speed {(r.speedScore * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {data.allEstimates.map(e => (
            <div key={e.provider}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700">{PROVIDER_LABELS[e.provider]}</span>
                <span className="text-gray-500">${(e.estimatedCostCents / 100).toFixed(5)}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{ width: `${(e.estimatedCostCents / maxCost) * 100}%`, backgroundColor: PROVIDER_COLORS[e.provider] }}
                />
              </div>
              <div className="mt-1 flex gap-3 text-[10px] text-gray-400">
                <span>{e.estimatedInputTokens} input tokens</span>
                <span>{e.estimatedOutputTokens} output tokens</span>
                <span>~{e.estimatedLatencyMs}ms</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3 rounded-md bg-gray-50 p-3">
        <div className="text-center">
          <p className="text-[10px] text-gray-500">Cheapest</p>
          <p className="text-xs font-semibold text-gray-800">
            {PROVIDER_LABELS[[...data.allEstimates].sort((a, b) => a.estimatedCostCents - b.estimatedCostCents)[0]?.provider ?? 'gemini']}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-gray-500">Fastest</p>
          <p className="text-xs font-semibold text-gray-800">
            {PROVIDER_LABELS[[...data.allEstimates].sort((a, b) => a.estimatedLatencyMs - b.estimatedLatencyMs)[0]?.provider ?? 'gemini']}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-gray-500">Best Value</p>
          <p className="text-xs font-semibold text-gray-800">
            {data.ranked[0] ? PROVIDER_LABELS[data.ranked[0].provider] : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
