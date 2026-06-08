'use client';

import React, { useState } from 'react';

interface LineageTransformation {
  type: 'embedding' | 'deduplication' | 'relationship' | 'pii_masking' | 'enrichment';
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface LineageRecord {
  entityId: string;
  workspaceId: string;
  sourceConnectorId: string;
  sourceSyncJobId?: string;
  sourceApiTimestamp?: string;
  transformations: LineageTransformation[];
  lastModifiedBy: string;
  lastModifiedAt: string;
}

const TRANSFORMATION_LABELS: Record<LineageTransformation['type'], string> = {
  embedding: 'Embedding Generated',
  deduplication: 'Deduplication Check',
  relationship: 'Relationship Indexed',
  pii_masking: 'PII Masked',
  enrichment: 'Entity Enriched',
};

const TRANSFORMATION_COLORS: Record<LineageTransformation['type'], string> = {
  embedding: 'bg-blue-100 text-blue-800',
  deduplication: 'bg-purple-100 text-purple-800',
  relationship: 'bg-green-100 text-green-800',
  pii_masking: 'bg-red-100 text-red-800',
  enrichment: 'bg-yellow-100 text-yellow-800',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function TransformationStep({ step }: { step: LineageTransformation }) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = step.metadata && Object.keys(step.metadata).length > 0;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-3 h-3 rounded-full bg-gray-400 mt-1 shrink-0" />
        <div className="w-px flex-1 bg-gray-200 mt-1" />
      </div>
      <div className="pb-4 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TRANSFORMATION_COLORS[step.type]}`}>
            {TRANSFORMATION_LABELS[step.type]}
          </span>
          <span className="text-xs text-gray-500">{formatDate(step.timestamp)}</span>
          {hasMetadata && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-blue-600 hover:underline"
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
        {expanded && hasMetadata && (
          <pre className="mt-2 text-xs bg-gray-50 rounded p-2 overflow-x-auto">
            {JSON.stringify(step.metadata, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

interface EntityLineageViewerProps {
  lineage: LineageRecord | null;
  isLoading?: boolean;
}

export function EntityLineageViewer({ lineage, isLoading }: EntityLineageViewerProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="h-3 bg-gray-200 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (!lineage) {
    return (
      <div className="rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-500">
        No lineage data recorded for this entity.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
      {/* Origin section */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Origin</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Connector</dt>
          <dd className="font-mono text-gray-900">{lineage.sourceConnectorId}</dd>

          {lineage.sourceSyncJobId && (
            <>
              <dt className="text-gray-500">Sync Job</dt>
              <dd className="font-mono text-gray-900 truncate">{lineage.sourceSyncJobId}</dd>
            </>
          )}

          {lineage.sourceApiTimestamp && (
            <>
              <dt className="text-gray-500">API Timestamp</dt>
              <dd className="text-gray-900">{formatDate(lineage.sourceApiTimestamp)}</dd>
            </>
          )}

          <dt className="text-gray-500">Last Modified By</dt>
          <dd className="text-gray-900">{lineage.lastModifiedBy}</dd>

          <dt className="text-gray-500">Last Modified</dt>
          <dd className="text-gray-900">{formatDate(lineage.lastModifiedAt)}</dd>
        </dl>
      </div>

      {/* Transformations timeline */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Transformations
          <span className="ml-2 text-xs font-normal text-gray-400">
            ({lineage.transformations.length})
          </span>
        </h3>

        {lineage.transformations.length === 0 ? (
          <p className="text-sm text-gray-400">No transformations recorded.</p>
        ) : (
          <div className="mt-1">
            {lineage.transformations.map((step, i) => (
              <TransformationStep key={i} step={step} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
