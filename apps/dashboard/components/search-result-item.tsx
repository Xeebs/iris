'use client';

import type { SearchResultItem as SearchResultItemType } from '@iris/semantic-core/hybrid-search-engine';

interface SearchResultItemProps {
  item: SearchResultItemType;
  onSelect?: (item: SearchResultItemType) => void;
  showExplanation?: boolean;
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  contact: 'bg-blue-100 text-blue-800',
  company: 'bg-purple-100 text-purple-800',
  deal: 'bg-green-100 text-green-800',
  issue: 'bg-orange-100 text-orange-800',
  page: 'bg-gray-100 text-gray-800',
  record: 'bg-yellow-100 text-yellow-800',
};

function typeColor(entityType: string): string {
  return ENTITY_TYPE_COLORS[entityType] ?? 'bg-slate-100 text-slate-800';
}

function AttributeList({ attributes }: { attributes: Record<string, unknown> }) {
  const entries = Object.entries(attributes).slice(0, 4);
  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1 text-xs text-gray-500">
          <dt className="font-medium capitalize">{k}:</dt>
          <dd>{String(v ?? '')}</dd>
        </div>
      ))}
    </dl>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span className="w-20 shrink-0">{label}</span>
      <div className="h-1.5 w-24 rounded-full bg-gray-200">
        <div
          className="h-1.5 rounded-full bg-indigo-400"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span>{pct}%</span>
    </div>
  );
}

/**
 * Renders a single search result with highlighted label, attributes, and optional score explanation.
 */
export function SearchResultItem({ item, onSelect, showExplanation }: SearchResultItemProps) {
  const hasExplanation = showExplanation && item.explanation;

  return (
    <div
      className="group cursor-pointer rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
      onClick={() => onSelect?.(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(item); }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${typeColor(item.entityType)}`}>
              {item.entityType}
            </span>
            {item.highlightedLabel ? (
              <span
                className="truncate font-medium text-gray-900"
                dangerouslySetInnerHTML={{ __html: item.highlightedLabel }}
              />
            ) : (
              <span className="truncate font-medium text-gray-900">{item.label}</span>
            )}
          </div>

          <AttributeList attributes={item.attributes} />

          {item.sourceConnectorId && (
            <p className="mt-1 text-xs text-gray-400">
              Source: {item.sourceConnectorId}
              {item.lastModified && (
                <> &middot; {new Date(item.lastModified).toLocaleDateString()}</>
              )}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right text-xs text-gray-400">
          <span className="font-mono">{(item.relevanceScore * 100).toFixed(1)}%</span>
        </div>
      </div>

      {hasExplanation && item.explanation && (
        <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
          <p className="mb-1 text-xs font-medium text-gray-500">Score breakdown</p>
          <ScoreBar score={item.explanation.bm25Score} label="BM25" />
          <ScoreBar score={item.explanation.semanticScore} label="Semantic" />
          <ScoreBar score={item.explanation.rrfScore * 1000} label="RRF" />
          <div className="mt-1 flex gap-4 text-xs text-gray-400">
            {item.explanation.bm25Rank && <span>BM25 rank #{item.explanation.bm25Rank}</span>}
            {item.explanation.semanticRank && <span>Semantic rank #{item.explanation.semanticRank}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
