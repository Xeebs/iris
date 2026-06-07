import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import crypto from 'node:crypto';

import { getAuth } from '@hono/clerk-auth';

import { logger } from '@iris/core/logger';
import { EmailService, buildInviteEmail } from '@iris/core/email-service';

const log = logger.child({ route: 'team-management' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
  inviterName: z.string().min(1).default('A team member'),
  workspaceName: z.string().min(1).default('your workspace'),
  baseUrl: z.string().url().optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
  status: z.enum(['active', 'pending', 'removed']).optional(),
});

/** Expiry for invitation tokens: 7 days */
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * @param sql - Postgres client
 * @param emailService - Email sending service (optional; skipped in tests if absent)
 * @returns Hono router mounted at /workspace/members
 */
export function createTeamManagementRoutes(
  sql: SqlClient,
  emailService?: EmailService,
): Hono {
  const app = new Hono();

  /** GET /workspace/members — list all members and pending invitations */
  app.get('/', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { limit, cursor, status } = parsed.data;
    const statusFilter = status ?? null;

    try {
      const rows = cursor
        ? await sql`
            SELECT id, workspace_id, user_id, email, role, invite_status, joined_at, created_at
            FROM workspace_members
            WHERE workspace_id = ${workspaceId}
              AND (${statusFilter}::text IS NULL OR invite_status = ${statusFilter}::text)
              AND created_at < (SELECT created_at FROM workspace_members WHERE id = ${cursor})
            ORDER BY created_at DESC
            LIMIT ${limit + 1}
          `
        : await sql`
            SELECT id, workspace_id, user_id, email, role, invite_status, joined_at, created_at
            FROM workspace_members
            WHERE workspace_id = ${workspaceId}
              AND (${statusFilter}::text IS NULL OR invite_status = ${statusFilter}::text)
            ORDER BY created_at DESC
            LIMIT ${limit + 1}
          `;

      const hasMore = rows.length > limit;
      const members = rows.slice(0, limit);
      const nextCursor =
        hasMore && members.length > 0
          ? (members[members.length - 1] as { id: string }).id
          : undefined;

      return c.json({
        data: members.map(mapMemberRow),
        meta: { hasMore, ...(nextCursor ? { nextCursor } : {}) },
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to list workspace members', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list members' } }, 500);
    }
  });

  /** POST /workspace/members/invite — invite a new user to the workspace */
  app.post('/invite', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { email, role, inviterName, workspaceName, baseUrl } = parsed.data;

    // Check for existing active or pending member with same email
    const existing = await sql`
      SELECT id, invite_status FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND email = ${email}
        AND invite_status IN ('active', 'pending')
    `.catch(() => []);

    if (existing.length > 0) {
      return c.json(
        { error: { code: 'CONFLICT', message: 'User with this email is already a member or has a pending invite' } },
        409,
      );
    }

    // Create pending member record + invitation token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO workspace_members (workspace_id, user_id, email, role, invite_status)
          VALUES (${workspaceId}, ${`pending:${token.slice(0, 8)}`}, ${email}, ${role}, 'pending')
        `;
        await tx`
          INSERT INTO team_invitations (workspace_id, email, role, invited_by, token, expires_at)
          VALUES (${workspaceId}, ${email}, ${role}, ${inviterName}, ${token}, ${expiresAt.toISOString()})
        `;
      });

      // Send invitation email (best-effort; don't fail the request if email fails)
      if (emailService) {
        const inviteUrl = `${baseUrl ?? 'https://app.iris.ai'}/accept-invite/${token}`;
        const emailContent = buildInviteEmail(inviterName, workspaceName, inviteUrl);
        const emailResult = await emailService.send({ to: { email }, ...emailContent });
        if (emailResult.isErr()) {
          log.warn('Failed to send invite email', { email, error: emailResult.error.message });
        }
      }

      log.info('Workspace invitation sent', { workspaceId, email, role });
      return c.json({ data: { email, role, status: 'pending', expiresAt } }, 201);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to create invitation', { workspaceId, email, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create invitation' } }, 500);
    }
  });

  /** POST /workspace/members/accept/:token — accept an invitation */
  app.post('/accept/:token', async (c) => {
    const token = c.req.param('token');
    const userId: string = getAuth(c)?.userId ?? 'unknown';

    try {
      const invites = await sql`
        SELECT i.id, i.workspace_id, i.email, i.role
        FROM team_invitations i
        WHERE i.token = ${token}
          AND i.accepted_at IS NULL
          AND i.revoked_at IS NULL
          AND i.expires_at > now()
        LIMIT 1
      `;

      if (invites.length === 0) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Invitation not found or expired' } },
          404,
        );
      }

      const invite = invites[0] as { id: string; workspace_id: string; email: string; role: string };

      await sql.begin(async (tx) => {
        await tx`
          UPDATE team_invitations SET accepted_at = now() WHERE id = ${invite.id}
        `;
        await tx`
          UPDATE workspace_members
          SET user_id = ${userId}, invite_status = 'active', joined_at = now(), updated_at = now()
          WHERE workspace_id = ${invite.workspace_id}
            AND email = ${invite.email}
            AND invite_status = 'pending'
        `;
      });

      log.info('Workspace invitation accepted', { workspaceId: invite.workspace_id, userId, email: invite.email });
      return c.json({ data: { workspaceId: invite.workspace_id, role: invite.role, status: 'active' } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to accept invitation', { token: token.slice(0, 8), error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to accept invitation' } }, 500);
    }
  });

  /** PUT /workspace/members/:userId/role — change a member's role */
  app.put('/:userId/role', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const memberId = c.req.param('userId');
    const body = await c.req.json().catch(() => null);

    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    try {
      const rows = await sql`
        UPDATE workspace_members
        SET role = ${parsed.data.role}, updated_at = now()
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${memberId}
          AND invite_status = 'active'
        RETURNING id, user_id, email, role
      `;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Member not found in this workspace' } }, 404);
      }

      const member = rows[0] as { id: string; user_id: string; email: string; role: string };
      log.info('Member role updated', { workspaceId, userId: memberId, newRole: parsed.data.role });
      return c.json({ data: { userId: member.user_id, email: member.email, role: member.role } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to update member role', { workspaceId, memberId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update role' } }, 500);
    }
  });

  /** DELETE /workspace/members/:userId — remove a member from the workspace */
  app.delete('/:userId', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const memberId = c.req.param('userId');

    try {
      const rows = await sql`
        UPDATE workspace_members
        SET invite_status = 'removed', updated_at = now()
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${memberId}
          AND invite_status = 'active'
        RETURNING id
      `;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Member not found in this workspace' } }, 404);
      }

      log.info('Member removed from workspace', { workspaceId, userId: memberId });
      return c.json({ data: { userId: memberId, status: 'removed' } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to remove member', { workspaceId, memberId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to remove member' } }, 500);
    }
  });

  /** GET /workspace/members/invitations — list pending invitations for workspace */
  app.get('/invitations', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;

    try {
      const rows = await sql`
        SELECT id, email, role, invited_by, expires_at, created_at
        FROM team_invitations
        WHERE workspace_id = ${workspaceId}
          AND accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC
      `;

      return c.json({
        data: rows.map((r) => {
          const row = r as {
            id: string; email: string; role: string;
            invited_by: string; expires_at: Date; created_at: Date;
          };
          return {
            id: row.id,
            email: row.email,
            role: row.role,
            invitedBy: row.invited_by,
            expiresAt: row.expires_at,
            createdAt: row.created_at,
          };
        }),
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to list invitations', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list invitations' } }, 500);
    }
  });

  /** DELETE /workspace/members/invitations/:id — revoke a pending invitation */
  app.delete('/invitations/:id', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const inviteId = c.req.param('id');

    try {
      const rows = await sql`
        UPDATE team_invitations
        SET revoked_at = now()
        WHERE id = ${inviteId}
          AND workspace_id = ${workspaceId}
          AND accepted_at IS NULL
          AND revoked_at IS NULL
        RETURNING id
      `;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Invitation not found or already processed' } }, 404);
      }

      return c.json({ data: { id: inviteId, status: 'revoked' } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to revoke invitation', { workspaceId, inviteId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke invitation' } }, 500);
    }
  });

  return app;
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

interface MemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  role: string;
  invite_status: string;
  joined_at: Date | null;
  created_at: Date;
}

function mapMemberRow(r: unknown) {
  const row = r as MemberRow;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    status: row.invite_status,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
  };
}
