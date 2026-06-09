'use client';

import { useEffect, useState } from 'react';
import { PerformanceMatrix } from '../../../../components/performance-matrix.js';
import { RegressionAlerts } from '../../../../components/regression-alerts.js';
import { BenchmarkTrends } from '../../../../components/benchmark-trends.js';

type BenchmarkMetrics = {
  connectorId: string;
  entityType: string;
  dataSize: number;
  durationMs: number;
  throughputPerSec: number;
  memoryPeakMb: number;
  apiCallCount: number;
  errorRate: number;
  avgTransformMs: number;
  runAt: string;
};

type Tab = 'matrix' | 'regression' | 'trends';

const CONNECTORS = ['hubspot', 'salesforce', 'notion', 'github', 'jira', 'slack'];
const ENTITY_TYPES = ['contact', 'deal', 'company', 'activity'];

export default function ConnectorBenchmarksPage() {
  const [activeTab, setActiveTab] = useState<Tab>('matrix');
  const [matrixData, setMatrixData] = useState<Record<string, Record<string, BenchmarkMetrics | null>>>({});
  const [trendData, setTrendData] = useState<BenchmarkMetrics[]>([]);
  const [selectedConnector, setSelectedConnector] = useState(CONNECTORS[0]!);
  const [selectedEntityType, setSelectedEntityType] = useState(ENTITY_TYPES[0]!);
  const [loading, setLoading] = useState(false);
  const [regressionReports, setRegressionReports] = useState<Array<{
    connectorId: string;
    entityType: string;
    hasRegression: boolean;
    throughputDeltaPct: number;
    memoryDeltaPct: number;
    details: string;
  }>>([]);

  useEffect(() => {
    void fetchMatrix();
  }, []);

  useEffect(() => {
    void fetchTrends();
  }, [selectedConnector, selectedEntityType]);

  async function fetchMatrix() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/connector-benchmarks/benchmark-matrix', {
        method: 'POST',
        body: JSON.stringify({ connectorIds: CONNECTORS, entityTypes: ENTITY_TYPES }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const body = (await res.json()) as { data: typeof matrixData };
        setMatrixData(body.data ?? {});
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchTrends() {
    try {
      const res = await fetch(
        `/api/v1/connector-benchmarks/${selectedConnector}/benchmark-results?entityType=${selectedEntityType}&limit=20`
      );
      if (res.ok) {
        const body = (await res.json()) as { data: BenchmarkMetrics[] };
        setTrendData(body.data ?? []);
      }
    } catch {
      // ignore
    }
  }

  async function runBenchmark() {
    setLoading(true);
    try {
      await fetch(`/api/v1/connector-benchmarks/${selectedConnector}/benchmark`, {
        method: 'POST',
        body: JSON.stringify({ entityType: selectedEntityType, dataSize: 1000 }),
        headers: { 'Content-Type': 'application/json' },
      });
      await Promise.all([fetchMatrix(), fetchTrends()]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Connector Performance Benchmarks</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={selectedConnector}
            onChange={(e) => setSelectedConnector(e.target.value)}
            style={{ padding: '0.35rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem' }}
          >
            {CONNECTORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={selectedEntityType}
            onChange={(e) => setSelectedEntityType(e.target.value)}
            style={{ padding: '0.35rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem' }}
          >
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            onClick={() => void runBenchmark()}
            disabled={loading}
            style={{ padding: '0.35rem 0.9rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
          >
            {loading ? 'Running…' : 'Run Benchmark'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '2px solid #e5e7eb' }}>
        {([['matrix', 'Performance Matrix'], ['regression', 'Regression Alerts'], ['trends', 'Trends']] as [Tab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.5rem 1rem', border: 'none', background: 'transparent', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab ? '#3b82f6' : '#6b7280', fontWeight: activeTab === tab ? 600 : 400,
              fontSize: '0.875rem', marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'matrix' && (
        <div>
          {loading && <p style={{ color: '#9ca3af' }}>Loading…</p>}
          {Object.keys(matrixData).length > 0 ? (
            <PerformanceMatrix
              matrix={matrixData}
              entityTypes={ENTITY_TYPES}
              connectorIds={CONNECTORS}
              metric="throughput"
            />
          ) : (
            <p style={{ color: '#9ca3af' }}>No benchmark data yet. Run a benchmark to populate.</p>
          )}
        </div>
      )}

      {activeTab === 'regression' && (
        <RegressionAlerts
          reports={regressionReports}
          onDismiss={(connectorId, entityType) => {
            setRegressionReports((prev) => prev.filter((r) => !(r.connectorId === connectorId && r.entityType === entityType)));
          }}
        />
      )}

      {activeTab === 'trends' && (
        <BenchmarkTrends
          connectorId={selectedConnector}
          entityType={selectedEntityType}
          points={trendData.map((d) => ({
            runAt: d.runAt,
            throughputPerSec: d.throughputPerSec,
            memoryPeakMb: d.memoryPeakMb,
            durationMs: d.durationMs,
          }))}
          metric="throughput"
        />
      )}
    </div>
  );
}
