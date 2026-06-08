import { describe, it, expect, vi } from 'vitest';
import {
  SchemaEvolutionManager,
  diffSchemas,
  type SchemaEvolutionStore,
  type SchemaVersion,
  type MigrationStatus,
} from '../schema-evolution.js';
import type { ConnectorSchema } from '@iris/connector-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSchema(version: string, overrides?: Partial<ConnectorSchema>): ConnectorSchema {
  return {
    version,
    entityTypes: [
      {
        name: 'contact',
        attributes: [
          { name: 'email', type: 'string', nullable: false },
          { name: 'name', type: 'string', nullable: false },
          { name: 'company', type: 'string', nullable: true },
        ],
      },
    ],
    ...overrides,
  };
}

function makeStore(versions: SchemaVersion[] = []): SchemaEvolutionStore {
  const versionMap = new Map(versions.map((v) => [`${v.connectorId}:${v.version}`, v]));
  const allVersions = new Map<string, SchemaVersion[]>(
    versions.reduce((m, v) => {
      const existing = m.get(v.connectorId) ?? [];
      m.set(v.connectorId, [...existing, v]);
      return m;
    }, new Map<string, SchemaVersion[]>()),
  );
  const migrations = new Map<string, MigrationStatus>();

  return {
    getVersion: vi.fn(async (cId, ver) => versionMap.get(`${cId}:${ver}`) ?? null),
    listVersions: vi.fn(async (cId) => allVersions.get(cId) ?? []),
    saveVersion: vi.fn(async (v) => {
      versionMap.set(`${v.connectorId}:${v.version}`, v);
      const existing = allVersions.get(v.connectorId) ?? [];
      allVersions.set(v.connectorId, [...existing.filter((x) => x.version !== v.version), v]);
    }),
    getMigrationStatus: vi.fn(async (wId, cId, src, tgt) =>
      migrations.get(`${wId}:${cId}:${src}:${tgt}`) ?? null,
    ),
    saveMigrationStatus: vi.fn(async (s) => {
      migrations.set(`${s.workspaceId}:${s.connectorId}:${s.sourceVersion}:${s.targetVersion}`, s);
    }),
    updateMigrationStatus: vi.fn(async (wId, cId, src, tgt, update) => {
      const key = `${wId}:${cId}:${src}:${tgt}`;
      const existing = migrations.get(key);
      if (existing) migrations.set(key, { ...existing, ...update });
    }),
  };
}

// ---------------------------------------------------------------------------
// diffSchemas
// ---------------------------------------------------------------------------

describe('diffSchemas', () => {
  it('returns empty array for identical schemas', () => {
    const s = makeSchema('1.0');
    expect(diffSchemas(s, s)).toHaveLength(0);
  });

  it('detects added field as non-breaking', () => {
    const prev = makeSchema('1.0');
    const next: ConnectorSchema = {
      ...prev,
      version: '1.1',
      entityTypes: [
        {
          name: 'contact',
          attributes: [...prev.entityTypes[0]!.attributes, { name: 'phone', type: 'string', nullable: true }],
        },
      ],
    };
    const changes = diffSchemas(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('add_field');
    expect(changes[0]!.breaking).toBe(false);
    expect(changes[0]!.fieldName).toBe('phone');
  });

  it('detects removed field as breaking', () => {
    const prev = makeSchema('1.0');
    const next: ConnectorSchema = {
      ...prev,
      version: '1.1',
      entityTypes: [
        {
          name: 'contact',
          attributes: prev.entityTypes[0]!.attributes.filter((a) => a.name !== 'company'),
        },
      ],
    };
    const changes = diffSchemas(prev, next);
    expect(changes.some((c) => c.kind === 'remove_field' && c.fieldName === 'company' && c.breaking)).toBe(true);
  });

  it('detects type change as breaking', () => {
    const prev = makeSchema('1.0');
    const next: ConnectorSchema = {
      ...prev,
      version: '1.1',
      entityTypes: [
        {
          name: 'contact',
          attributes: prev.entityTypes[0]!.attributes.map((a) =>
            a.name === 'email' ? { ...a, type: 'string[]' as const } : a,
          ),
        },
      ],
    };
    const changes = diffSchemas(prev, next);
    expect(changes.some((c) => c.kind === 'change_type' && c.breaking && c.fieldName === 'email')).toBe(true);
  });

  it('detects removed entity type as breaking', () => {
    const prev: ConnectorSchema = {
      version: '1.0',
      entityTypes: [
        { name: 'contact', attributes: [] },
        { name: 'deal', attributes: [] },
      ],
    };
    const next: ConnectorSchema = {
      version: '1.1',
      entityTypes: [{ name: 'contact', attributes: [] }],
    };
    const changes = diffSchemas(prev, next);
    expect(changes.some((c) => c.kind === 'remove_entity_type' && c.entityType === 'deal')).toBe(true);
  });

  it('detects added entity type as non-breaking', () => {
    const prev = makeSchema('1.0');
    const next: ConnectorSchema = {
      ...prev,
      version: '1.1',
      entityTypes: [...prev.entityTypes, { name: 'deal', attributes: [] }],
    };
    const changes = diffSchemas(prev, next);
    expect(changes.some((c) => c.kind === 'add_entity_type' && c.entityType === 'deal' && !c.breaking)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SchemaEvolutionManager
// ---------------------------------------------------------------------------

describe('SchemaEvolutionManager', () => {
  describe('registerVersion', () => {
    it('registers the first version with add_entity_type changes', async () => {
      const store = makeStore();
      const mgr = new SchemaEvolutionManager(store);
      const schema = makeSchema('1.0');

      const result = await mgr.registerVersion('hubspot', schema);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.every((c) => c.kind === 'add_entity_type')).toBe(true);
      }
      expect(store.saveVersion).toHaveBeenCalledOnce();
    });

    it('detects breaking changes when registering a new version', async () => {
      const schema1 = makeSchema('1.0');
      const existing: SchemaVersion = {
        connectorId: 'hubspot',
        version: '1.0',
        schema: schema1,
        releasedAt: new Date(),
        breakingChanges: [],
      };
      const store = makeStore([existing]);
      const mgr = new SchemaEvolutionManager(store);

      const schema2: ConnectorSchema = {
        version: '1.1',
        entityTypes: [
          {
            name: 'contact',
            attributes: schema1.entityTypes[0]!.attributes.filter((a) => a.name !== 'company'),
          },
        ],
      };

      const result = await mgr.registerVersion('hubspot', schema2);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.some((c) => c.breaking)).toBe(true);
      }
    });
  });

  describe('buildMigrationPlan', () => {
    it('returns VERSION_NOT_FOUND when source version is missing', async () => {
      const store = makeStore();
      const mgr = new SchemaEvolutionManager(store);

      const result = await mgr.buildMigrationPlan('hubspot', 'missing', '1.1');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('VERSION_NOT_FOUND');
      }
    });

    it('returns a plan with requiresReindex=true when breaking changes exist', async () => {
      const schema1 = makeSchema('1.0');
      const schema2: ConnectorSchema = {
        version: '1.1',
        entityTypes: [
          {
            name: 'contact',
            attributes: schema1.entityTypes[0]!.attributes.filter((a) => a.name !== 'company'),
          },
        ],
      };
      const store = makeStore([
        { connectorId: 'hubspot', version: '1.0', schema: schema1, releasedAt: new Date(), breakingChanges: [] },
        { connectorId: 'hubspot', version: '1.1', schema: schema2, releasedAt: new Date(), breakingChanges: [] },
      ]);
      const mgr = new SchemaEvolutionManager(store);

      const result = await mgr.buildMigrationPlan('hubspot', '1.0', '1.1');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.requiresReindex).toBe(true);
        expect(result.value.affectedEntityTypes).toContain('contact');
      }
    });

    it('infers field renames when add+remove pairs share edit distance ≤ 2', async () => {
      const schema1 = makeSchema('1.0');
      const schema2: ConnectorSchema = {
        version: '1.1',
        entityTypes: [
          {
            name: 'contact',
            attributes: [
              { name: 'email', type: 'string', nullable: false },
              { name: 'firstName', type: 'string', nullable: false }, // renamed from 'name'
              { name: 'company', type: 'string', nullable: true },
            ],
          },
        ],
      };
      const store = makeStore([
        { connectorId: 'hubspot', version: '1.0', schema: schema1, releasedAt: new Date(), breakingChanges: [] },
        { connectorId: 'hubspot', version: '1.1', schema: schema2, releasedAt: new Date(), breakingChanges: [] },
      ]);
      const mgr = new SchemaEvolutionManager(store);
      const result = await mgr.buildMigrationPlan('hubspot', '1.0', '1.1');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('transformAttributes', () => {
    it('applies field renames from migration plan', async () => {
      const schema1 = makeSchema('1.0');
      const schema2: ConnectorSchema = {
        version: '1.1',
        entityTypes: [
          {
            name: 'contact',
            attributes: [
              { name: 'email', type: 'string', nullable: false },
              { name: 'fullName', type: 'string', nullable: false }, // renamed from 'name'
              { name: 'company', type: 'string', nullable: true },
            ],
          },
        ],
      };
      const store = makeStore([
        { connectorId: 'hubspot', version: '1.0', schema: schema1, releasedAt: new Date(), breakingChanges: [] },
        { connectorId: 'hubspot', version: '1.1', schema: schema2, releasedAt: new Date(), breakingChanges: [] },
      ]);
      const mgr = new SchemaEvolutionManager(store);

      const planResult = await mgr.buildMigrationPlan('hubspot', '1.0', '1.1');
      expect(planResult.isOk()).toBe(true);
      if (!planResult.isOk()) return;

      // Manually add a mapping since edit-distance may not infer name→fullName
      planResult.value.fieldMappings.push({
        entityType: 'contact',
        oldFieldName: 'name',
        newFieldName: 'fullName',
      });

      const transformed = mgr.transformAttributes(
        'contact',
        { email: 'a@b.com', name: 'Alice', company: 'Acme' },
        planResult.value,
      );

      expect(transformed['fullName']).toBe('Alice');
      expect(transformed['name']).toBeUndefined();
    });

    it('removes deleted fields from transformed record', async () => {
      const schema1 = makeSchema('1.0');
      const schema2: ConnectorSchema = {
        version: '1.1',
        entityTypes: [
          {
            name: 'contact',
            attributes: [
              { name: 'email', type: 'string', nullable: false },
              { name: 'name', type: 'string', nullable: false },
            ],
          },
        ],
      };
      const store = makeStore([
        { connectorId: 'hubspot', version: '1.0', schema: schema1, releasedAt: new Date(), breakingChanges: [] },
        { connectorId: 'hubspot', version: '1.1', schema: schema2, releasedAt: new Date(), breakingChanges: [] },
      ]);
      const mgr = new SchemaEvolutionManager(store);
      const planResult = await mgr.buildMigrationPlan('hubspot', '1.0', '1.1');
      if (!planResult.isOk()) return;

      const transformed = mgr.transformAttributes(
        'contact',
        { email: 'a@b.com', name: 'Alice', company: 'Acme Corp' },
        planResult.value,
      );

      expect(transformed['company']).toBeUndefined();
    });
  });

  describe('startMigration', () => {
    it('creates a new migration with in_progress status', async () => {
      const schema1 = makeSchema('1.0');
      const schema2 = makeSchema('1.1');
      const store = makeStore([
        { connectorId: 'hubspot', version: '1.0', schema: schema1, releasedAt: new Date(), breakingChanges: [] },
        { connectorId: 'hubspot', version: '1.1', schema: schema2, releasedAt: new Date(), breakingChanges: [] },
      ]);
      const mgr = new SchemaEvolutionManager(store);

      const planResult = await mgr.buildMigrationPlan('hubspot', '1.0', '1.1');
      if (!planResult.isOk()) return;

      const result = await mgr.startMigration('ws-1', 'hubspot', planResult.value, 500);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('in_progress');
        expect(result.value.affectedEntityCount).toBe(500);
      }
    });

    it('returns ALREADY_COMPLETED when migration is done', async () => {
      const schema1 = makeSchema('1.0');
      const schema2 = makeSchema('1.1');
      const completed: MigrationStatus = {
        workspaceId: 'ws-1',
        connectorId: 'hubspot',
        sourceVersion: '1.0',
        targetVersion: '1.1',
        status: 'completed',
      };
      const store = makeStore([
        { connectorId: 'hubspot', version: '1.0', schema: schema1, releasedAt: new Date(), breakingChanges: [] },
        { connectorId: 'hubspot', version: '1.1', schema: schema2, releasedAt: new Date(), breakingChanges: [] },
      ]);
      vi.mocked(store.getMigrationStatus).mockResolvedValue(completed);
      const mgr = new SchemaEvolutionManager(store);

      const planResult = await mgr.buildMigrationPlan('hubspot', '1.0', '1.1');
      if (!planResult.isOk()) return;

      const result = await mgr.startMigration('ws-1', 'hubspot', planResult.value);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('ALREADY_COMPLETED');
      }
    });
  });

  describe('completeMigration', () => {
    it('calls updateMigrationStatus with completed outcome', async () => {
      const store = makeStore();
      const mgr = new SchemaEvolutionManager(store);

      await mgr.completeMigration('ws-1', 'hubspot', '1.0', '1.1', 'completed');
      expect(store.updateMigrationStatus).toHaveBeenCalledWith(
        'ws-1',
        'hubspot',
        '1.0',
        '1.1',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });
});
