import { BackupManager } from '@/components/backup-manager';

export const metadata = {
  title: 'Backup & Export — Iris Admin',
};

export default function BackupPage() {
  const workspaceId = process.env['DEFAULT_WORKSPACE_ID'] ?? 'default';

  return (
    <div className="container mx-auto max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Backup & Export</h1>
        <p className="text-muted-foreground mt-1">
          Export workspace data for portability, disaster recovery, or migration.
        </p>
      </div>
      <BackupManager workspaceId={workspaceId} />
    </div>
  );
}
