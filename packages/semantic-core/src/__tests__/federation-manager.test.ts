import { describe, it, expect, vi } from 'vitest';
import {
  checkFederatedPermission,
  mergeFederatedResults,
  registerFederatedWorkspace,
  getFederatedRelationships,
  queryFederatedContext,
  auditFederatedAccess,
  getFederationAuditLog,
  revokeFederatedWorkspace,
  type FederatedPermissions,
  type FederatedEntity,
} from '../federation-manager';

describe('checkFederatedPermission', () => {
  it('returns false when permissions list is empty', () => {
    expect(checkFederatedPermission([], 'contact')).toBe(false);
  });

  it('grants access for exact entity type match', () => {
    const perms: FederatedPermissions[] = [{ entityTypePattern: 'contact', canRead: true, canWrite: false }];
    expect(checkFederatedPermission(perms, 'contact')).toBe(true);
  });

  it('grants access with wildcard pattern *', () => {
    const perms: FederatedPermissions[] = [{ entityTypePattern: '*', canRead: true, canWrite: false }];
    expect(checkFederatedPermission(perms, 'deal')).toBe(true);
    expect(checkFederatedPermission(perms, 'contact')).toBe(true);
  });

  it('grants access with prefix wildcard pattern', () => {
    const perms: FederatedPermissions[] = [{ entityTypePattern: 'crm_*', canRead: true, canWrite: false }];
    expect(checkFederatedPermission(perms, 'crm_contact')).toBe(true);
    expect(checkFederatedPermission(perms, 'crm_deal')).toBe(true);
    expect(checkFederatedPermission(perms, 'billing_invoice')).toBe(false);
  });

  it('denies access when canRead is false', () => {
    const perms: FederatedPermissions[] = [{ entityTypePattern: 'contact', canRead: false, canWrite: true }];
    expect(checkFederatedPermission(perms, 'contact')).toBe(false);
  });

  it('denies access for non-matching entity type', () => {
    const perms: FederatedPermissions[] = [{ entityTypePattern: 'deal', canRead: true, canWrite: false }];
    expect(checkFederatedPermission(perms, 'contact')).toBe(false);
  });

  it('grants access if any permission matches', () => {
    const perms: FederatedPermissions[] = [
      { entityTypePattern: 'deal', canRead: true, canWrite: false },
      { entityTypePattern: 'contact', canRead: true, canWrite: false },
    ];
    expect(checkFederatedPermission(perms, 'contact')).toBe(true);
  });
});

describe('mergeFederatedResults', () => {
  const makeEntity = (id: string, type: string, label: string, workspaceId: string): FederatedEntity => ({
    id, type, label, attributes: {}, sourceWorkspaceId: workspaceId, confidence: 0.9,
  });

  it('merges entities from multiple workspaces', () => {
    const batch1 = [makeEntity('1', 'contact', 'Alice', 'ws1')];
    const batch2 = [makeEntity('2', 'deal', 'Q1 Deal', 'ws2')];
    const { entities } = mergeFederatedResults([batch1, batch2]);
    expect(entities).toHaveLength(2);
  });

  it('deduplicates by type+label across workspaces', () => {
    const batch1 = [makeEntity('1', 'contact', 'Alice', 'ws1')];
    const batch2 = [makeEntity('2', 'contact', 'Alice', 'ws2')]; // same type+label
    const { entities } = mergeFederatedResults([batch1, batch2]);
    expect(entities).toHaveLength(1);
  });

  it('respects maxTokenBudget and sets truncated', () => {
    const entities = Array.from({ length: 100 }, (_, i) =>
      makeEntity(String(i), 'contact', `Contact_${'X'.repeat(70)}_${i}`, 'ws1')
    );
    const { truncated } = mergeFederatedResults([entities], 200);
    expect(truncated).toBe(true);
  });

  it('is not truncated when under budget', () => {
    const batch = [makeEntity('1', 'contact', 'Alice', 'ws1')];
    const { truncated, tokenCount } = mergeFederatedResults([batch], 10000);
    expect(truncated).toBe(false);
    expect(tokenCount).toBeGreaterThan(0);
  });

  it('handles empty input gracefully', () => {
    const { entities, tokenCount } = mergeFederatedResults([]);
    expect(entities).toHaveLength(0);
    expect(tokenCount).toBe(0);
  });

  it('keeps case-insensitive deduplication for labels', () => {
    const batch1 = [makeEntity('1', 'contact', 'alice', 'ws1')];
    const batch2 = [makeEntity('2', 'contact', 'Alice', 'ws2')];
    const { entities } = mergeFederatedResults([batch1, batch2]);
    expect(entities).toHaveLength(1);
  });
});

describe('registerFederatedWorkspace', () => {
  it('inserts relationship and permissions, returns relationship', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ id: 'rel1', source_workspace_id: 'ws1', target_workspace_id: 'ws2', relationship_type: 'sibling', created_by_user_id: 'u1', trusted_at: '2026-06-08T00:00:00Z' }])
      .mockResolvedValue([]);
    const perms: FederatedPermissions[] = [{ entityTypePattern: '*', canRead: true, canWrite: false }];
    const result = await registerFederatedWorkspace(sql as unknown as Parameters<typeof registerFederatedWorkspace>[0], 'ws1', 'ws2', 'sibling', perms, 'u1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.id).toBe('rel1');
      expect(result.value.permissions).toHaveLength(1);
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('constraint violation'));
    const result = await registerFederatedWorkspace(sql as unknown as Parameters<typeof registerFederatedWorkspace>[0], 'ws1', 'ws2', 'partner', [], 'u1');
    expect(result.isErr()).toBe(true);
  });
});

describe('getFederatedRelationships', () => {
  it('aggregates permissions per relationship', async () => {
    const sql = vi.fn().mockResolvedValue([
      { id: 'r1', source_workspace_id: 'ws1', target_workspace_id: 'ws2', relationship_type: 'sibling', created_by_user_id: 'u1', trusted_at: '2026-06-08T00:00:00Z', entity_type_pattern: 'contact', can_read: true, can_write: false },
      { id: 'r1', source_workspace_id: 'ws1', target_workspace_id: 'ws2', relationship_type: 'sibling', created_by_user_id: 'u1', trusted_at: '2026-06-08T00:00:00Z', entity_type_pattern: 'deal', can_read: true, can_write: false },
    ]);
    const result = await getFederatedRelationships(sql as unknown as Parameters<typeof getFederatedRelationships>[0], 'ws1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.permissions).toHaveLength(2);
    }
  });

  it('returns empty array when no relationships', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await getFederatedRelationships(sql as unknown as Parameters<typeof getFederatedRelationships>[0], 'ws-new');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toHaveLength(0);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await getFederatedRelationships(sql as unknown as Parameters<typeof getFederatedRelationships>[0], 'ws1');
    expect(result.isErr()).toBe(true);
  });
});

describe('auditFederatedAccess', () => {
  it('inserts audit row and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await auditFederatedAccess(sql as unknown as Parameters<typeof auditFederatedAccess>[0], 'q1', 'ws1', ['ws2', 'ws3'], 15);
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledOnce();
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await auditFederatedAccess(sql as unknown as Parameters<typeof auditFederatedAccess>[0], 'q1', 'ws1', [], 0);
    expect(result.isErr()).toBe(true);
  });
});

describe('getFederationAuditLog', () => {
  it('returns parsed audit entries', async () => {
    const sql = vi.fn().mockResolvedValue([
      { query_id: 'q1', source_workspace_id: 'ws1', queried_workspaces: '["ws2","ws3"]', entity_count: 5, accessed_at: '2026-06-08T10:00:00Z' },
    ]);
    const result = await getFederationAuditLog(sql as unknown as Parameters<typeof getFederationAuditLog>[0], 'ws1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.queriedWorkspaces).toEqual(['ws2', 'ws3']);
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await getFederationAuditLog(sql as unknown as Parameters<typeof getFederationAuditLog>[0], 'ws1');
    expect(result.isErr()).toBe(true);
  });
});

describe('revokeFederatedWorkspace', () => {
  it('deletes relationship and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await revokeFederatedWorkspace(sql as unknown as Parameters<typeof revokeFederatedWorkspace>[0], 'ws1', 'ws2');
    expect(result.isOk()).toBe(true);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('constraint error'));
    const result = await revokeFederatedWorkspace(sql as unknown as Parameters<typeof revokeFederatedWorkspace>[0], 'ws1', 'ws2');
    expect(result.isErr()).toBe(true);
  });
});

describe('queryFederatedContext', () => {
  it('returns permission denied for unknown target workspaces', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([]);
    const result = await queryFederatedContext(sql as unknown as Parameters<typeof queryFederatedContext>[0], 'show contacts', 'ws1', ['unknown-ws'], 2000);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.permissionDenied).toContain('unknown-ws');
      expect(result.value.entities).toHaveLength(0);
    }
  });

  it('returns Err when DB throws on relationship lookup', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db down'));
    const result = await queryFederatedContext(sql as unknown as Parameters<typeof queryFederatedContext>[0], 'query', 'ws1', ['ws2']);
    expect(result.isErr()).toBe(true);
  });
});
