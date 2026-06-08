'use client';

import React, { useState } from 'react';

type ScoringBreakdown = {
  entityId: string;
  totalScore: number;
  vectorSimilarity: number;
  freshnessBonus: number;
  relationshipBonus: number;
  typeMatchBonus: number;
  label: string;
  type: string;
};

type EntityExplanation = {
  entity: { id: string; type: string; label: string };
  score: number;
  scoring: ScoringBreakdown;
  relevanceReason: string;
};

type RetrievalAnomaly = {
  type: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
};

type ExpansionSuggestion = {
  entityId: string;
  label: string;
  type: string;
  relationshipType: string;
  sourceEntityId: string;
};

type RetrievalExplanation = {
  query: string;
  totalRetrieved: number;
  entityTypeDistribution: Record<string, number>;
  explanations: EntityExplanation[];
  anomalies: RetrievalAnomaly[];
  expansionSuggestions: ExpansionSuggestion[];
  avgScore: number;
};

type Props = {
  explanation: RetrievalExplanation;
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

function ScoreBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-gray-600 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${Math.min(value * 100, 100).toFixed(1)}%` }}
        />
      </div>
      <span className="w-12 text-right tabular-nums text-gray-700">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function EntityExplanationRow({ ex }: { ex: EntityExplanation }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
            {ex.entity.type}
          </span>
          <span className="text-sm font-medium text-gray-800">{ex.entity.label}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{(ex.score * 100).toFixed(0)}% match</span>
          <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="p-3 border-t bg-gray-50 space-y-2">
          <p className="text-xs text-gray-600 italic">{ex.relevanceReason}</p>
          <div className="space-y-1.5">
            <ScoreBar value={ex.scoring.vectorSimilarity} label="Vector similarity" color="bg-indigo-400" />
            <ScoreBar value={ex.scoring.freshnessBonus * 10} label="Freshness" color="bg-green-400" />
            <ScoreBar value={ex.scoring.relationshipBonus * 20} label="Relationships" color="bg-blue-400" />
            <ScoreBar value={ex.scoring.typeMatchBonus * 20} label="Type match" color="bg-purple-400" />
          </div>
          <p className="text-xs text-gray-400 pt-1">Entity ID: {ex.entity.id}</p>
        </div>
      )}
    </div>
  );
}

export function QueryExplanationPanel({ explanation }: Props) {
  return (
    <div className="space-y-5 p-4">
      {/* Header summary */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Query Explanation</h3>
          <p className="text-xs text-gray-500 mt-0.5">"{explanation.query}"</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-indigo-600">{(explanation.avgScore * 100).toFixed(0)}%</p>
          <p className="text-xs text-gray-500">avg match</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-4 text-center">
        <div className="flex-1 bg-gray-50 rounded-lg p-2">
          <p className="text-lg font-bold text-gray-800">{explanation.totalRetrieved}</p>
          <p className="text-xs text-gray-500">entities</p>
        </div>
        <div className="flex-1 bg-gray-50 rounded-lg p-2">
          <p className="text-lg font-bold text-gray-800">{Object.keys(explanation.entityTypeDistribution).length}</p>
          <p className="text-xs text-gray-500">types</p>
        </div>
        <div className="flex-1 bg-gray-50 rounded-lg p-2">
          <p className="text-lg font-bold text-gray-800">{explanation.anomalies.length}</p>
          <p className="text-xs text-gray-500">anomalies</p>
        </div>
      </div>

      {/* Anomalies */}
      {explanation.anomalies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Anomalies</h4>
          {explanation.anomalies.map((anomaly, i) => (
            <div key={i} className={`border rounded-lg p-3 text-xs ${SEVERITY_STYLES[anomaly.severity] ?? ''}`}>
              <span className="font-medium capitalize">{anomaly.severity}: </span>
              {anomaly.description}
            </div>
          ))}
        </div>
      )}

      {/* Entity explanations */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Retrieved Entities</h4>
        {explanation.explanations.map((ex) => (
          <EntityExplanationRow key={ex.entity.id} ex={ex} />
        ))}
        {explanation.explanations.length === 0 && (
          <p className="text-xs text-gray-400 italic">No entities retrieved.</p>
        )}
      </div>

      {/* Expansion suggestions */}
      {explanation.expansionSuggestions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Context Expansion Suggestions</h4>
          <div className="space-y-1.5">
            {explanation.expansionSuggestions.map((s) => (
              <div key={s.entityId} className="flex items-center justify-between text-xs p-2 bg-blue-50 rounded-lg border border-blue-100">
                <div>
                  <span className="font-medium text-blue-800">{s.entityId}</span>
                  <span className="text-blue-600 ml-2">via {s.relationshipType}</span>
                </div>
                <span className="text-blue-500 text-xs">from {s.sourceEntityId}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
