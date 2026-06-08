import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { BackupManager, findRestoreChain } from '@iris/semantic-core/backup-manager';

const CreateFullSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).optional(),
});

const CreateIncrementalSchema = z.object({
  baseBackupId: z.string().min(1),
  sinceTimestamp: z.string().datetime(),
});

const RestoreSchema = z.object({
  targetTimestamp: z.string().datetime(),
});

function workspaceId(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('x-workspace-id') ?? 'default';
}

export function makeBackupRecoveryRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const manager = new BackupManager(sql);

  app.get('/', async (c) => {
    const result = await manager.listBackups(workspaceId(c));
    if (result.isErr()) {
      return c.json({ error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  app.post('/full', async (c) => {
    const parsed = CreateFullSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const result = await manager.createFullBackup(workspaceId(c), parsed.data.retentionDays);
    if (result.isErr()) {
      return c.json({ error: { code: 'BACKUP_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  app.post('/incremental', async (c) => {
    const parsed = CreateIncrementalSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { baseBackupId, sinceTimestamp } = parsed.data;
    const result = await manager.createIncrementalBackup(workspaceId(c), baseBackupId, new Date(sinceTimestamp));
    if (result.isErr()) {
      return c.json({ error: { code: 'BACKUP_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  app.post('/:id/restore-to-point', async (c) => {
    const parsed = RestoreSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const backupId = c.req.param('id');
    const { targetTimestamp } = parsed.data;

    const listResult = await manager.listBackups(workspaceId(c));
    if (listResult.isErr()) {
      return c.json({ error: { code: 'LIST_FAILED', message: listResult.error.message } }, 500);
    }

    const chain = findRestoreChain(listResult.value, new Date(targetTimestamp));
    if (chain.length === 0) {
      return c.json({ error: { code: 'NO_RESTORE_POINT', message: 'No valid backup chain found for the requested timestamp' } }, 422);
    }

    const baseInChain = chain.find((m) => m.id === backupId);
    if (!baseInChain) {
      return c.json({ error: { code: 'BACKUP_NOT_IN_CHAIN', message: 'Specified backup is not in the restore chain' } }, 422);
    }

    const estimatedRtoMinutes = chain.reduce(
      (acc, m) => acc + Math.floor(m.sizeBytes / (1024 * 1024 * 1024)) + 1,
      2,
    );

    return c.json({
      data: {
        targetTimestamp,
        chain: chain.map((m) => ({ id: m.id, backupType: m.backupType, completedAt: m.completedAt })),
        estimatedRtoMinutes,
        status: 'restore_plan_ready',
      },
    });
  });

  app.get('/metrics', async (c) => {
    const result = await manager.getRtpRpoMetrics(workspaceId(c));
    if (result.isErr()) {
      return c.json({ error: { code: 'METRICS_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  app.post('/:id/validate', async (c) => {
    const result = await manager.validateBackupIntegrity(c.req.param('id'), workspaceId(c));
    if (result.isErr()) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { valid: result.value } });
  });

  app.post('/prune', async (c) => {
    const result = await manager.pruneOldBackups(workspaceId(c));
    if (result.isErr()) {
      return c.json({ error: { code: 'PRUNE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { prunedCount: result.value } });
  });

  return app;
}
