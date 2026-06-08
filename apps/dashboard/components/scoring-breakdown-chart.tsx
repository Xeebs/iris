'use client';

import React from 'react';

type ScoringFactor = {
  label: string;
  value: number;
  maxValue: number;
  color: string;
  description: string;
};

type Props = {
  vectorSimilarity: number;
  freshnessBonus: number;
  relationshipBonus: number;
  typeMatchBonus: number;
  entityLabel?: string;
};

export function ScoringBreakdownChart({
  vectorSimilarity,
  freshnessBonus,
  relationshipBonus,
  typeMatchBonus,
  entityLabel,
}: Props) {
  const factors: ScoringFactor[] = [
    {
      label: 'Vector Similarity',
      value: vectorSimilarity,
      maxValue: 1,
      color: 'bg-indigo-500',
      description: 'Cosine similarity between query embedding and entity embedding',
    },
    {
      label: 'Freshness Bonus',
      value: freshnessBonus,
      maxValue: 0.1,
      color: 'bg-green-500',
      description: 'Recency bonus (max +0.10 for entities updated within 7 days)',
    },
    {
      label: 'Relationship Bonus',
      value: relationshipBonus,
      maxValue: 0.05,
      color: 'bg-blue-500',
      description: 'Graph connectivity bonus (max +0.05 for well-connected entities)',
    },
    {
      label: 'Type Match Bonus',
      value: typeMatchBonus,
      maxValue: 0.05,
      color: 'bg-purple-500',
      description: 'Bonus when entity type appears in the query text (+0.05)',
    },
  ];

  const totalScore = vectorSimilarity + freshnessBonus + relationshipBonus + typeMatchBonus;
  const normalizedTotal = Math.min(totalScore, 1.2);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {entityLabel && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Scoring Breakdown</h3>
          <p className="text-xs text-gray-500 mt-0.5">{entityLabel}</p>
        </div>
      )}

      {/* Stacked bar */}
      <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden flex">
        {factors.map((f) => (
          <div
            key={f.label}
            className={`${f.color} h-full transition-all`}
            style={{ width: `${(f.value / 1.2) * 100}%` }}
            title={`${f.label}: ${(f.value * 100).toFixed(1)}%`}
          />
        ))}
      </div>

      <div className="flex justify-between text-xs text-gray-500">
        <span>0%</span>
        <span className="font-semibold text-gray-800">Total: {(normalizedTotal * 100).toFixed(0)}%</span>
        <span>120%</span>
      </div>

      {/* Factor rows */}
      <div className="space-y-3">
        {factors.map((f) => (
          <div key={f.label} className="space-y-1">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-sm ${f.color}`} />
                <span className="text-xs font-medium text-gray-700">{f.label}</span>
              </div>
              <span className="text-xs tabular-nums text-gray-600">
                +{(f.value * 100).toFixed(1)}% / {(f.maxValue * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className={`${f.color} h-1.5 rounded-full`}
                style={{ width: `${Math.min((f.value / f.maxValue) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">{f.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
