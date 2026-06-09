'use client';

import { useState, useEffect } from 'react';
import { ABTestRunner } from '../../../components/ab-test-runner.js';
import { RankingExplainer } from '../../../components/ranking-explainer.js';
import { QualityMetricsDashboard } from '../../../components/quality-metrics-dashboard.js';

type Tab = 'metrics' | 'ab-tests' | 'ranking';

export default function SearchQualityPage() {
  const [tab, setTab] = useState<Tab>('metrics');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'metrics', label: 'Quality Metrics' },
    { id: 'ab-tests', label: 'A/B Tests' },
    { id: 'ranking', label: 'Ranking Explainer' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Search Quality</h1>
        <p className="text-sm text-gray-400 mt-1">Evaluate ranking quality, run A/B experiments, and debug result ordering.</p>
      </header>

      <div className="flex border-b border-gray-700 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 text-sm font-medium transition-colors ${tab === t.id ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'metrics' && <QualityMetricsDashboard />}
      {tab === 'ab-tests' && <ABTestRunner />}
      {tab === 'ranking' && <RankingExplainer />}
    </div>
  );
}
