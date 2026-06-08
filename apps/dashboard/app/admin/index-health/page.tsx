'use client';

import { useState, useEffect, useCallback } from 'react';
import { IndexCorruptionDetector } from '@/components/index-corruption-detector';
import { RebuildProgressPanel } from '@/components/rebuild-progress-panel';

type JobType = 'deduplicate' | 'prune_stale' | 'rebalance' | 'integrity_check';
type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

interface MaintenanceJob {
  id: string;
  jobType: JobType;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  recordsAffected: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface IndexHealth {
  workspaceId: string;
  totalEntities: number;
  vectorStoreSize: number;
  orphanedEntities: number;
  duplicateEstimate: number;
  staleEntities: number;
  lastMaintenanceAt: string | null;
  healthScore: number;
}

const JOB_LABELS: Record<JobType, string> = {
  deduplicate: 'Deduplicate Index',
  prune_stale: 'Prune Stale Entities',
  rebalance: 'Rebalance Vector Index',
  integrity_check: 'Integrity Check',
};

const JOB_DESCRIPTIONS: Record<JobType, string> = {
  deduplicate: 'Merge semantically similar entities (≥92% similarity) to reduce noise',
  prune_stale: 'Remove entities not updated in 90+ days to free storage',
  rebalance: 'Run ANALYZE to improve query planner statistics',
  integrity_check: 'Find orphaned entities, broken relationships, and missing embeddings',
};

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: '#f59e0b',
  running: '#3b82f6',
  completed: '#10b981',
  failed: '#ef4444',
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function IndexHealthPage(): React.JSX.Element {
  const [health, setHealth] = useState<IndexHealth | null>(null);
  const [jobs, setJobs] = useState<MaintenanceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<JobType | null>(null);
  const [notification, setNotification] = useState<{ msg: string; ok: boolean } | null>(null);

  function showNotification(msg: string, ok: boolean) {
    setNotification({ msg, ok });
    setTimeout(() => setNotification(null), 5000);
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, jobsRes] = await Promise.all([
        fetch(`/api/v1/admin/index/health?workspaceId=${WORKSPACE_ID}`),
        fetch(`/api/v1/admin/index/maintenance?workspaceId=${WORKSPACE_ID}&limit=20`),
      ]);
      if (healthRes.ok) {
        const body = await healthRes.json() as { data: IndexHealth };
        setHealth(body.data);
      }
      if (jobsRes.ok) {
        const body = await jobsRes.json() as { data: MaintenanceJob[] };
        setJobs(body.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function triggerJob(jobType: JobType) {
    setRunning(jobType);
    try {
      const res = await fetch(`/api/v1/admin/index/maintenance/${jobType}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
      });
      const body = await res.json() as { error?: { message?: string } };
      if (res.ok) {
        showNotification(`${JOB_LABELS[jobType]} completed successfully`, true);
        await loadData();
      } else {
        showNotification(body.error?.message ?? 'Job failed', false);
      }
    } catch {
      showNotification('Network error — please try again', false);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Index Health & Maintenance</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 28 }}>Monitor index quality and run maintenance jobs to keep search accurate and storage efficient.</p>

        {notification && (
          <div style={{
            background: notification.ok ? '#d1fae5' : '#fee2e2',
            color: notification.ok ? '#065f46' : '#b91c1c',
            borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13, fontWeight: 500,
          }}>
            {notification.msg}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: '64px 0' }}>Loading…</div>
        ) : (
          <>
            {/* Health overview */}
            {health && (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <span style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>Health Score</span>
                  <span style={{
                    fontWeight: 800, fontSize: 22,
                    color: health.healthScore >= 90 ? '#10b981' : health.healthScore >= 70 ? '#f59e0b' : '#ef4444',
                  }}>
                    {health.healthScore}%
                  </span>
                </div>
                <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden', marginBottom: 20 }}>
                  <div style={{
                    height: '100%',
                    width: `${health.healthScore}%`,
                    background: health.healthScore >= 90 ? '#10b981' : health.healthScore >= 70 ? '#f59e0b' : '#ef4444',
                    borderRadius: 4,
                  }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
                  {[
                    { label: 'Total Entities', value: health.totalEntities.toLocaleString() },
                    { label: 'Storage Used', value: formatBytes(health.vectorStoreSize) },
                    { label: 'Orphaned', value: health.orphanedEntities.toLocaleString(), warn: health.orphanedEntities > 0 },
                    { label: 'Duplicates ~', value: health.duplicateEstimate.toLocaleString(), warn: health.duplicateEstimate > 50 },
                    { label: 'Stale (90d)', value: health.staleEntities.toLocaleString(), warn: health.staleEntities > 0 },
                    { label: 'Last Job', value: health.lastMaintenanceAt ? new Date(health.lastMaintenanceAt).toLocaleDateString() : 'Never' },
                  ].map((item) => (
                    <div key={item.label} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: item.warn ? '#f59e0b' : '#111827' }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trigger buttons */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#111827', marginBottom: 16 }}>Run Maintenance</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                {(Object.keys(JOB_LABELS) as JobType[]).map((jobType) => (
                  <div key={jobType} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', marginBottom: 4 }}>{JOB_LABELS[jobType]}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, lineHeight: 1.5 }}>{JOB_DESCRIPTIONS[jobType]}</div>
                    <button
                      onClick={() => void triggerJob(jobType)}
                      disabled={running !== null}
                      style={{
                        width: '100%', padding: '8px 0', borderRadius: 8, border: 'none',
                        background: running === jobType ? '#d1d5db' : '#6366f1',
                        color: running === jobType ? '#9ca3af' : '#fff',
                        fontWeight: 600, fontSize: 13,
                        cursor: running !== null ? 'default' : 'pointer',
                      }}
                    >
                      {running === jobType ? 'Running…' : 'Run Now'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Job history */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#111827', marginBottom: 16 }}>Job History</div>
              {jobs.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 14, fontStyle: 'italic' }}>No jobs run yet</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      {['Job', 'Status', 'Started', 'Duration', 'Records'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px', color: '#111827' }}>{JOB_LABELS[job.jobType]}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            background: STATUS_COLORS[job.status] + '20',
                            color: STATUS_COLORS[job.status],
                            borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600,
                          }}>
                            {job.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px', color: '#6b7280' }}>
                          {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '8px', color: '#6b7280' }}>{formatDuration(job.durationMs)}</td>
                        <td style={{ padding: '8px', color: '#6b7280' }}>{job.recordsAffected ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        <hr style={{ margin: '32px 0', borderColor: '#e5e7eb' }} />

        <IndexCorruptionDetector workspaceId={WORKSPACE_ID} />

        <hr style={{ margin: '32px 0', borderColor: '#e5e7eb' }} />

        <RebuildProgressPanel workspaceId={WORKSPACE_ID} />
      </div>
    </div>
  );
}
