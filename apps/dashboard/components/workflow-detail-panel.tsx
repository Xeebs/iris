'use client';

import React from 'react';
import type { CuratedTemplate } from './workflow-catalog-grid.js';

type ContextPreview = {
  suggestedContextBudget: number;
  recommendedEntityTypes: string[];
  contextHints: string[];
  estimatedTokens: number;
};

type Props = {
  template: CuratedTemplate;
  contextPreview?: ContextPreview | null;
  onExecute?: () => void;
  onClose?: () => void;
};

export function WorkflowDetailPanel({ template, contextPreview, onExecute, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-end z-50" onClick={onClose}>
      <aside
        className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold text-gray-900">{template.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-sm text-gray-600">{template.description}</p>

          {contextPreview && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 space-y-2">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Context Budget</p>
              <p className="text-sm text-blue-800">
                Suggested: <strong>{contextPreview.suggestedContextBudget.toLocaleString()}</strong> tokens
                &nbsp;(~{contextPreview.estimatedTokens.toLocaleString()} estimated)
              </p>
              {contextPreview.recommendedEntityTypes.length > 0 && (
                <p className="text-xs text-blue-600">
                  Entity types: {contextPreview.recommendedEntityTypes.join(', ')}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">MCP Tools</p>
            <ol className="space-y-2">
              {template.mcpCalls.map((call, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500 font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <span className="font-medium text-gray-800">{call.tool}</span>
                    {typeof (call.params as Record<string, unknown>)['query'] === 'string' && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        &ldquo;{String((call.params as Record<string, unknown>)['query'])}&rdquo;
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Context Hints</p>
            <ul className="space-y-1">
              {template.contextHints.map((hint, i) => (
                <li key={i} className="text-sm text-gray-600 flex items-center gap-1.5">
                  <span className="text-blue-400">•</span>
                  {hint}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Recommended Connectors
            </p>
            <div className="flex flex-wrap gap-2">
              {template.recommendedConnectors.map((c) => (
                <span key={c} className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full">
                  {c}
                </span>
              ))}
            </div>
          </div>

          {onExecute && (
            <button
              type="button"
              onClick={onExecute}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Execute Workflow
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
