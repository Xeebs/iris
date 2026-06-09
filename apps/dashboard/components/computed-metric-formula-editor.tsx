'use client';

import React, { useState } from 'react';

type ValidationState = 'idle' | 'valid' | 'error';

type Props = {
  formula: string;
  onFormulaChange: (f: string) => void;
  validationState: ValidationState;
  validationMessage?: string;
  disabled?: boolean;
};

const EXAMPLES = [
  { label: 'ARR', formula: 'sum(subscription.mrr) * 12' },
  { label: 'Avg deal size', formula: 'avg(deal.value)' },
  { label: 'Churn rate', formula: 'count(churned_contact.id) / count(contact.id)' },
  { label: 'Pipeline total', formula: 'sum(deal.value) + sum(opportunity.value)' },
];

export function ComputedMetricFormulaEditor({
  formula,
  onFormulaChange,
  validationState,
  validationMessage,
  disabled = false,
}: Props) {
  const [showHelp, setShowHelp] = useState(false);

  const borderClass =
    validationState === 'valid'
      ? 'border-green-400 focus:ring-green-300'
      : validationState === 'error'
        ? 'border-red-400 focus:ring-red-300'
        : 'border-gray-300 focus:ring-blue-300';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">Formula</label>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          {showHelp ? 'Hide help' : 'Show help'}
        </button>
      </div>

      <div className="relative">
        <textarea
          value={formula}
          onChange={(e) => onFormulaChange(e.target.value)}
          disabled={disabled}
          rows={3}
          placeholder="e.g. sum(subscription.mrr) * 12"
          className={`w-full px-3 py-2 border rounded-md font-mono text-sm resize-none focus:outline-none focus:ring-2 transition-colors ${borderClass} ${disabled ? 'bg-gray-50 text-gray-400' : 'bg-white'}`}
        />
        {validationState !== 'idle' && (
          <span className="absolute top-2 right-2">
            {validationState === 'valid' ? (
              <span className="text-green-500 text-lg">✓</span>
            ) : (
              <span className="text-red-500 text-lg">✗</span>
            )}
          </span>
        )}
      </div>

      {validationState === 'error' && validationMessage && (
        <p className="text-xs text-red-600 mt-1">{validationMessage}</p>
      )}
      {validationState === 'valid' && (
        <p className="text-xs text-green-600 mt-1">Formula is valid</p>
      )}

      {showHelp && (
        <div className="bg-gray-50 border rounded-md p-4 space-y-3 text-xs">
          <div>
            <p className="font-medium text-gray-700 mb-1">Supported functions</p>
            <div className="grid grid-cols-3 gap-1">
              {['sum(type.field)', 'avg(type.field)', 'count(type.field)', 'min(type.field)', 'max(type.field)'].map((fn) => (
                <code key={fn} className="bg-white border px-2 py-1 rounded font-mono">{fn}</code>
              ))}
            </div>
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">Operators</p>
            <code className="text-gray-600">+ - * / ( )</code>
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-2">Examples</p>
            <div className="space-y-1">
              {EXAMPLES.map(({ label, formula: ex }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onFormulaChange(ex)}
                  className="w-full text-left flex items-center justify-between px-2 py-1.5 bg-white border rounded hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <span className="text-gray-600 font-medium">{label}</span>
                  <code className="text-blue-700 text-xs">{ex}</code>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
