'use client';

import React, { useState } from 'react';

type ScoringWeights = {
  bm25_weight: number;
  embedding_weight: number;
  type_boost_contact: number;
  type_boost_deal: number;
  type_boost_company: number;
  recency_boost: number;
  relationship_distance_penalty: number;
};

type FeedbackMetric = {
  query: string;
  avgRank: number;
  clickCount: number;
  avgDwellMs: number | null;
};

type Props = {
  weights: ScoringWeights;
  defaults: ScoringWeights;
  metrics: FeedbackMetric[];
  onWeightChange?: (factorName: keyof ScoringWeights, value: number) => void;
  onReset?: () => void;
};

const FACTOR_META: Record<keyof ScoringWeights, { label: string; min: number; max: number; step: number; description: string }> = {
  bm25_weight: { label: 'BM25 Weight', min: 0, max: 1, step: 0.05, description: 'Keyword match contribution' },
  embedding_weight: { label: 'Embedding Weight', min: 0, max: 1, step: 0.05, description: 'Semantic similarity contribution' },
  type_boost_contact: { label: 'Contact Boost', min: 0.5, max: 2, step: 0.1, description: 'Multiply scores for contact entities' },
  type_boost_deal: { label: 'Deal Boost', min: 0.5, max: 2, step: 0.1, description: 'Multiply scores for deal entities' },
  type_boost_company: { label: 'Company Boost', min: 0.5, max: 2, step: 0.1, description: 'Multiply scores for company entities' },
  recency_boost: { label: 'Recency Bonus', min: 0, max: 1, step: 0.05, description: 'Extra score for recently updated entities' },
  relationship_distance_penalty: { label: 'Distance Penalty', min: 0, max: 0.5, step: 0.01, description: 'Penalize entities far from query entity' },
};

function WeightSlider({
  factorName,
  value,
  defaultValue,
  onChangeCommitted,
}: {
  factorName: keyof ScoringWeights;
  value: number;
  defaultValue: number;
  onChangeCommitted: (name: keyof ScoringWeights, val: number) => void;
}) {
  const [localValue, setLocalValue] = useState(value);
  const meta = FACTOR_META[factorName];
  const isModified = Math.abs(localValue - defaultValue) > 0.001;

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <div>
          <span className="text-sm font-medium text-gray-800">{meta.label}</span>
          {isModified && (
            <span className="ml-2 text-xs text-indigo-600 font-medium">modified</span>
          )}
        </div>
        <span className="text-sm tabular-nums font-mono text-gray-700 w-12 text-right">
          {localValue.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={localValue}
        onChange={(e) => setLocalValue(parseFloat(e.target.value))}
        onMouseUp={() => onChangeCommitted(factorName, localValue)}
        onTouchEnd={() => onChangeCommitted(factorName, localValue)}
        className="w-full h-2 bg-gray-200 rounded-full accent-indigo-600"
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>{meta.min}</span>
        <span className="text-gray-400 italic">{meta.description}</span>
        <span>{meta.max}</span>
      </div>
    </div>
  );
}

function FeedbackTable({ metrics }: { metrics: FeedbackMetric[] }) {
  if (metrics.length === 0) {
    return <p className="text-xs text-gray-400 italic">No feedback data yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-gray-500">
            <th className="text-left py-1 pr-3 font-medium">Query</th>
            <th className="text-right py-1 pr-3 font-medium">Avg Rank</th>
            <th className="text-right py-1 pr-3 font-medium">Clicks</th>
            <th className="text-right py-1 font-medium">Avg Dwell</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-1.5 pr-3 text-gray-800 max-w-xs truncate">{m.query}</td>
              <td className={`py-1.5 pr-3 text-right tabular-nums ${m.avgRank > 4 ? 'text-red-600' : 'text-gray-600'}`}>
                #{m.avgRank.toFixed(1)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">{m.clickCount}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-600">
                {m.avgDwellMs != null ? `${(m.avgDwellMs / 1000).toFixed(1)}s` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RelevanceTunerPanel({ weights, defaults, metrics, onWeightChange, onReset }: Props) {
  const [activeTab, setActiveTab] = useState<'weights' | 'metrics'>('weights');

  const handleChange = (factorName: keyof ScoringWeights, value: number) => {
    onWeightChange?.(factorName, value);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex border-b">
        {(['weights', 'metrics'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-5">
        {activeTab === 'weights' && (
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-gray-800">Scoring Weights</h3>
              <button
                onClick={onReset}
                className="text-xs text-gray-500 hover:text-red-600 transition-colors"
              >
                Reset to defaults
              </button>
            </div>
            <div className="space-y-4">
              {(Object.keys(FACTOR_META) as Array<keyof ScoringWeights>).map((factorName) => (
                <WeightSlider
                  key={factorName}
                  factorName={factorName}
                  value={weights[factorName]}
                  defaultValue={defaults[factorName]}
                  onChangeCommitted={handleChange}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'metrics' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-800">Click-through Feedback (30 days)</h3>
            <FeedbackTable metrics={metrics} />
          </div>
        )}
      </div>
    </div>
  );
}
