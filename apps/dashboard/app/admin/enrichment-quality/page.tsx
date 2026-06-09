'use client';

import { useState } from 'react';
import { CompletenessHeatmap } from '@/components/completeness-heatmap';
import { SourceReliabilityScorecard } from '@/components/source-reliability-scorecard';
import { EnrichmentGapHistogram } from '@/components/enrichment-gap-histogram';

const CONNECTORS = ['clearbit', 'linkedin', 'crunchbase'];
const ENTITY_TYPES = ['contact', 'company', 'deal'];

export default function EnrichmentQualityPage() {
  const [selectedConnector, setSelectedConnector] = useState(CONNECTORS[0]!);
  const [selectedEntityType, setSelectedEntityType] = useState(ENTITY_TYPES[0]!);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Enrichment Quality</h1>
          <p className="mt-1 text-sm text-gray-500">
            Coverage, confidence, freshness, and source diversity for enriched entities.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm"
            value={selectedConnector}
            onChange={(e) => setSelectedConnector(e.target.value)}
          >
            {CONNECTORS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm"
            value={selectedEntityType}
            onChange={(e) => setSelectedEntityType(e.target.value)}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Completeness heatmap: entity type × field */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-700">Attribute Completeness</h2>
        <CompletenessHeatmap connectorId={selectedConnector} entityTypes={ENTITY_TYPES} />
      </section>

      {/* Gap frequency histogram */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-700">Enrichment Gaps</h2>
        <EnrichmentGapHistogram
          connectorId={selectedConnector}
          entityType={selectedEntityType}
        />
      </section>

      {/* Source reliability scorecard */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-700">Source Reliability</h2>
        <SourceReliabilityScorecard connectorIds={CONNECTORS} />
      </section>
    </div>
  );
}
