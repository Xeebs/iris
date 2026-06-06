import { describe, it, expect } from 'vitest';
import type { SemanticEntity } from '@iris/connector-sdk';
import { filterContextByRole } from '../context-permissions.js';
import type { ContextPermissions } from '../context-permissions.js';

function makeEntity(type: string, id: string, attributes: Record<string, string | null> = {}): SemanticEntity {
  return {
    id,
    type,
    label: `Test ${id}`,
    attributes,
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: id,
  };
}

function makePermissions(
  roleName: string,
  permissions: Array<{ entityType: string; allowedFields: string[] }>,
): ContextPermissions {
  return {
    role: { id: 'role-1', workspaceId: 'ws-1', roleName, description: '' },
    permissions,
    allowedEntityTypes: new Set(permissions.map((p) => p.entityType)),
  };
}

describe('filterContextByRole', () => {
  describe('entity type filtering', () => {
    it('removes entities whose type is not in allowedEntityTypes', () => {
      const entities = [
        makeEntity('contact', 'c1'),
        makeEntity('deal', 'd1'),
        makeEntity('invoice', 'i1'),
      ];
      const perms = makePermissions('sales', [
        { entityType: 'contact', allowedFields: [] },
        { entityType: 'deal', allowedFields: [] },
      ]);

      const result = filterContextByRole(entities, perms);

      expect(result).toHaveLength(2);
      expect(result.map((e) => e.id)).toEqual(['c1', 'd1']);
    });

    it('returns empty array when no entity types are permitted', () => {
      const entities = [makeEntity('contact', 'c1'), makeEntity('deal', 'd1')];
      const perms = makePermissions('viewer', []);

      const result = filterContextByRole(entities, perms);
      expect(result).toHaveLength(0);
    });

    it('returns all entities when all types are permitted', () => {
      const entities = [makeEntity('contact', 'c1'), makeEntity('deal', 'd1')];
      const perms = makePermissions('admin', [
        { entityType: 'contact', allowedFields: [] },
        { entityType: 'deal', allowedFields: [] },
      ]);

      const result = filterContextByRole(entities, perms);
      expect(result).toHaveLength(2);
    });
  });

  describe('field filtering', () => {
    it('keeps only allowed fields when allowedFields is non-empty', () => {
      const entity = makeEntity('contact', 'c1', {
        email: 'alice@example.com',
        phone: '555-1234',
        company: 'Acme',
        salary: '100000',
      });
      const perms = makePermissions('limited', [
        { entityType: 'contact', allowedFields: ['email', 'company'] },
      ]);

      const [result] = filterContextByRole([entity], perms);

      expect(result.attributes).toEqual({ email: 'alice@example.com', company: 'Acme' });
      expect(result.attributes).not.toHaveProperty('phone');
      expect(result.attributes).not.toHaveProperty('salary');
    });

    it('keeps all fields when allowedFields is empty array', () => {
      const entity = makeEntity('contact', 'c1', {
        email: 'alice@example.com',
        phone: '555-1234',
      });
      const perms = makePermissions('full', [
        { entityType: 'contact', allowedFields: [] },
      ]);

      const [result] = filterContextByRole([entity], perms);
      expect(result.attributes).toEqual({ email: 'alice@example.com', phone: '555-1234' });
    });

    it('preserves non-attribute fields (id, type, label, relationships, etc)', () => {
      const entity = makeEntity('deal', 'd1', { amount: '5000' });
      const perms = makePermissions('finance', [
        { entityType: 'deal', allowedFields: ['amount'] },
      ]);

      const [result] = filterContextByRole([entity], perms);
      expect(result.id).toBe('d1');
      expect(result.type).toBe('deal');
      expect(result.label).toBe('Test d1');
      expect(result.relationships).toEqual([]);
      expect(result.sourceId).toBe('d1');
    });

    it('returns empty attributes when no fields are in allowedFields and none match', () => {
      const entity = makeEntity('contact', 'c1', { email: 'a@b.com', phone: '123' });
      const perms = makePermissions('minimal', [
        { entityType: 'contact', allowedFields: ['nonexistent_field'] },
      ]);

      const [result] = filterContextByRole([entity], perms);
      expect(result.attributes).toEqual({});
    });
  });

  describe('mixed scenarios', () => {
    it('filters both entity types and fields simultaneously', () => {
      const entities = [
        makeEntity('contact', 'c1', { email: 'a@b.com', salary: '90k' }),
        makeEntity('deal', 'd1', { amount: '5000', notes: 'private' }),
        makeEntity('invoice', 'i1', { total: '200' }),
      ];
      const perms = makePermissions('sales-limited', [
        { entityType: 'contact', allowedFields: ['email'] },
        { entityType: 'deal', allowedFields: ['amount'] },
        // invoice not listed → blocked
      ]);

      const result = filterContextByRole(entities, perms);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('c1');
      expect(result[0]!.attributes).toEqual({ email: 'a@b.com' });
      expect(result[1]!.id).toBe('d1');
      expect(result[1]!.attributes).toEqual({ amount: '5000' });
    });

    it('does not mutate the original entities array', () => {
      const entities = [makeEntity('contact', 'c1', { email: 'a@b.com', salary: '90k' })];
      const perms = makePermissions('read-only', [
        { entityType: 'contact', allowedFields: ['email'] },
      ]);

      filterContextByRole(entities, perms);

      expect(entities[0]!.attributes).toHaveProperty('salary');
    });
  });
});
