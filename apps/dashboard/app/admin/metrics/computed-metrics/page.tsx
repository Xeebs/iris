'use client';

import React, { useState } from 'react';
import { ComputedMetricFormulaEditor } from '@/components/computed-metric-formula-editor';
import { ComputationResults } from '@/components/computation-results';
import type { ComputedMetric } from '@/components/computation-results';

type ValidationState = 'idle' | 'valid' | 'error';

const SAMPLE_METRICS: ComputedMetric[] = [
  {
    metricId: 'ws-1:arr',
    name: 'ARR',
    formulaText: 'sum(subscription.mrr) * 12',
    description: 'Annual recurring revenue',
    lastComputedValue: 1_440_000,
    lastComputedAt: new Date().toISOString(),
    status: 'success',
    error: null,
  },
  {
    metricId: 'ws-1:avgdeal',
    name: 'Avg Deal Size',
    formulaText: 'avg(deal.value)',
    description: 'Average value of all deals',
    lastComputedValue: 12_500,
    lastComputedAt: new Date().toISOString(),
    status: 'success',
    error: null,
  },
];

export default function ComputedMetricsPage() {
  const [selectedMetric, setSelectedMetric] = useState<ComputedMetric | null>(SAMPLE_METRICS[0] ?? null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFormula, setNewFormula] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [validation, setValidation] = useState<ValidationState>('idle');
  const [validationMessage, setValidationMessage] = useState('');

  const handleFormulaChange = (f: string) => {
    setNewFormula(f);
    if (!f.trim()) { setValidation('idle'); return; }
    const balanced = (f.match(/\(/g)?.length ?? 0) === (f.match(/\)/g)?.length ?? 0);
    if (!balanced) {
      setValidation('error');
      setValidationMessage('Unbalanced parentheses');
    } else if (/[^a-zA-Z0-9\s().+\-*/,_]/.test(f)) {
      setValidation('error');
      setValidationMessage('Invalid characters in formula');
    } else {
      setValidation('valid');
      setValidationMessage('');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Computed Metrics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Define custom business metrics using formulas over indexed entity data.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showNewForm ? 'Cancel' : 'New Metric'}
        </button>
      </div>

      {showNewForm && (
        <div className="border rounded-xl p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">Define New Metric</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. ARR"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Description</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What does this metric represent?"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          <ComputedMetricFormulaEditor
            formula={newFormula}
            onFormulaChange={handleFormulaChange}
            validationState={validation}
            validationMessage={validationMessage}
          />
          <button
            type="button"
            disabled={validation !== 'valid' || !newName.trim()}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save Metric
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-2">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Defined Metrics</h2>
          {SAMPLE_METRICS.map((m) => (
            <button
              key={m.metricId}
              type="button"
              onClick={() => setSelectedMetric(m)}
              className={`w-full text-left p-4 border rounded-lg transition-colors ${selectedMetric?.metricId === m.metricId ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900 text-sm">{m.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${m.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {m.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{m.formulaText}</p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selectedMetric ? (
            <ComputationResults metric={selectedMetric} recentComputations={[]} />
          ) : (
            <div className="p-8 text-center text-gray-400 border border-dashed rounded-xl">
              Select a metric to view results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
