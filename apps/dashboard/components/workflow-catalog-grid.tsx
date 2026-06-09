'use client';

import React from 'react';

export type CuratedTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  recommendedConnectors: string[];
  contextHints: string[];
  mcpCalls: Array<{ tool: string; params: Record<string, unknown> }>;
};

type Props = {
  templates: CuratedTemplate[];
  onSelect?: (template: CuratedTemplate) => void;
};

const CATEGORY_COLORS: Record<string, string> = {
  sales: 'bg-blue-100 text-blue-700',
  finance: 'bg-green-100 text-green-700',
  ops: 'bg-orange-100 text-orange-700',
  engineering: 'bg-purple-100 text-purple-700',
  'customer-success': 'bg-teal-100 text-teal-700',
};

export function WorkflowCatalogGrid({ templates, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((tpl) => (
        <div
          key={tpl.id}
          onClick={() => onSelect?.(tpl)}
          className="p-5 border border-gray-200 rounded-xl bg-white hover:shadow-md hover:border-blue-300 cursor-pointer transition-all"
        >
          <div className="flex items-start justify-between mb-3">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[tpl.category] ?? 'bg-gray-100 text-gray-600'}`}>
              {tpl.category}
            </span>
            <span className="text-xs text-gray-400">
              {tpl.mcpCalls.length} tool{tpl.mcpCalls.length !== 1 ? 's' : ''}
            </span>
          </div>

          <h3 className="text-sm font-semibold text-gray-900 mb-1">{tpl.name}</h3>
          <p className="text-xs text-gray-500 mb-3 line-clamp-2">{tpl.description}</p>

          <div className="flex flex-wrap gap-1">
            {tpl.recommendedConnectors.slice(0, 3).map((c) => (
              <span key={c} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                {c}
              </span>
            ))}
            {tpl.recommendedConnectors.length > 3 && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-400 rounded-full">
                +{tpl.recommendedConnectors.length - 3}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
