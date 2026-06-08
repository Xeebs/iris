'use client';

import { useEffect, useState } from 'react';
import { RtoRpoMetrics } from '../../../components/rto-rpo-metrics.js';
import { BackupCalendar } from '../../../components/backup-calendar.js';
import { PointInTimeRestoreWizard } from '../../../components/point-in-time-restore-wizard.js';

type Backup = {
  id: string;
  backupType: 'full' | 'incremental';
  status: string;
  completedAt: string | null;
  entityCount: number;
};

type Metrics = {
  estimatedRpoHours: number;
  estimatedRtoMinutes: number;
  lastBackupAt: string | null;
  backupCount: { full: number; incremental: number };
};

export default function BackupRecoveryPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | 'full' | 'incremental'>(null);
  const [pruning, setPruning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [backupRes, metricsRes] = await Promise.all([
      fetch('/api/v1/backups'),
      fetch('/api/v1/backups/metrics'),
    ]);
    if (backupRes.ok) {
      const json = await backupRes.json();
      setBackups(json.data ?? []);
    }
    if (metricsRes.ok) {
      const json = await metricsRes.json();
      setMetrics(json.data ?? null);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function createFull() {
    setCreating('full');
    setError(null);
    try {
      const res = await fetch('/api/v1/backups/full', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retentionDays: 30 }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error?.message ?? 'Backup failed');
      } else {
        await refresh();
      }
    } finally {
      setCreating(null);
    }
  }

  async function createIncremental() {
    const lastFull = backups.find((b) => b.backupType === 'full' && b.status === 'ready');
    if (!lastFull) {
      setError('No full backup found to base the incremental on.');
      return;
    }
    setCreating('incremental');
    setError(null);
    try {
      const since = lastFull.completedAt ?? new Date(0).toISOString();
      const res = await fetch('/api/v1/backups/incremental', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseBackupId: lastFull.id, sinceTimestamp: since }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error?.message ?? 'Incremental backup failed');
      } else {
        await refresh();
      }
    } finally {
      setCreating(null);
    }
  }

  async function pruneOld() {
    setPruning(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/backups/prune', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? 'Prune failed');
      } else {
        await refresh();
      }
    } finally {
      setPruning(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Backup & Recovery</h1>
          <p className="text-sm text-zinc-400 mt-1">Manage backups and point-in-time restore for your workspace data.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={createFull}
            disabled={!!creating}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded"
          >
            {creating === 'full' ? 'Creating…' : 'Full backup'}
          </button>
          <button
            onClick={createIncremental}
            disabled={!!creating}
            className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded"
          >
            {creating === 'incremental' ? 'Creating…' : 'Incremental backup'}
          </button>
          <button
            onClick={pruneOld}
            disabled={pruning}
            className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 rounded"
          >
            {pruning ? 'Pruning…' : 'Prune old'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">RTO / RPO Metrics</h2>
        <RtoRpoMetrics metrics={metrics} />
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Backup History</h2>
        <BackupCalendar
          backups={backups}
          onRestore={(id) => setRestoreTarget(id)}
        />
      </section>

      {restoreTarget && (
        <PointInTimeRestoreWizard
          backupId={restoreTarget}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}
