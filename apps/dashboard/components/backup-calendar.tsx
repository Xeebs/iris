'use client';

type Backup = {
  id: string;
  backupType: 'full' | 'incremental';
  status: string;
  completedAt: string | null;
  entityCount: number;
};

function BackupRow({ backup, onRestore }: { backup: Backup; onRestore: (id: string) => void }) {
  const typeColor = backup.backupType === 'full' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' : 'bg-purple-500/20 text-purple-300 border-purple-500/30';
  const statusColor = backup.status === 'ready' ? 'text-green-400' : backup.status === 'failed' ? 'text-red-400' : 'text-zinc-400';

  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-700 last:border-0">
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded text-xs border ${typeColor}`}>
          {backup.backupType}
        </span>
        <div>
          <div className="text-sm text-zinc-200 font-mono">{backup.id.slice(0, 8)}…</div>
          <div className="text-xs text-zinc-500">
            {backup.completedAt ? new Date(backup.completedAt).toLocaleString() : 'In progress'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className={`text-sm font-medium ${statusColor}`}>{backup.status}</div>
          <div className="text-xs text-zinc-500">{backup.entityCount.toLocaleString()} entities</div>
        </div>
        {backup.status === 'ready' && (
          <button
            onClick={() => onRestore(backup.id)}
            className="px-3 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors"
          >
            Restore to point
          </button>
        )}
      </div>
    </div>
  );
}

export function BackupCalendar({
  backups,
  onRestore,
}: {
  backups: Backup[];
  onRestore: (id: string) => void;
}) {
  if (backups.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-center text-zinc-500 text-sm">
        No backups yet. Create a full backup to start protecting your data.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700">
      {backups.map((b) => (
        <div key={b.id} className="px-4">
          <BackupRow backup={b} onRestore={onRestore} />
        </div>
      ))}
    </div>
  );
}
