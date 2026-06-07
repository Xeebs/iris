import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SemanticEntity } from '@iris/connector-sdk';
import type { WorkspacePiiConfig, PiiStrategy } from '../pii-masker.js';
import { detectPiiType, maskValue, maskEntity, maskEntities, PiiConfigService } from '../pii-masker.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(attributes: Record<string, unknown>): SemanticEntity {
  return {
    id: 'contact:1',
    type: 'contact',
    label: 'Alice Smith',
    attributes,
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: 'hubspot:contact:1',
  };
}

const BASE_CONFIG: WorkspacePiiConfig = {
  workspaceId: 'ws1',
  enableAutoDetection: true,
  defaultStrategy: 'redact',
  fieldConfigs: [],
  tokenizationKey: 'test-key-abc',
};

// ─── detectPiiType ────────────────────────────────────────────────────────────

describe('detectPiiType', () => {
  it('detects email by field name', () => {
    expect(detectPiiType('email', 'alice@example.com')).toBe('email');
  });

  it('detects email by value pattern', () => {
    expect(detectPiiType('contact_info', 'alice@example.com')).toBe('email');
  });

  it('detects phone by field name', () => {
    expect(detectPiiType('phone_number', '+1-555-123-4567')).toBe('phone');
  });

  it('detects SSN by value pattern', () => {
    expect(detectPiiType('identifier', '123-45-6789')).toBe('ssn');
  });

  it('detects credit card by value', () => {
    expect(detectPiiType('payment', '4111 1111 1111 1111')).toBe('credit_card');
  });

  it('detects IP address by value', () => {
    expect(detectPiiType('last_ip', '192.168.1.100')).toBe('ip_address');
  });

  it('returns null for non-PII field', () => {
    expect(detectPiiType('company', 'Acme Corp')).toBeNull();
  });

  it('returns null for non-PII value', () => {
    expect(detectPiiType('notes', 'nothing special here')).toBeNull();
  });

  it('returns null for numeric non-PII value', () => {
    expect(detectPiiType('revenue', 50000)).toBeNull();
  });

  it('detects date_of_birth field name', () => {
    expect(detectPiiType('date_of_birth', '1990-01-01')).toBe('custom');
  });
});

// ─── maskValue ────────────────────────────────────────────────────────────────

describe('maskValue', () => {
  it('redacts any value', () => {
    expect(maskValue('alice@example.com', 'redact')).toBe('[REDACTED]');
  });

  it('hashes value to 16-char hex', () => {
    const result = maskValue('alice@example.com', 'hash');
    expect(result).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(result)).toBe(true);
  });

  it('hash is deterministic', () => {
    expect(maskValue('alice@example.com', 'hash')).toBe(maskValue('alice@example.com', 'hash'));
  });

  it('hash of different inputs differs', () => {
    expect(maskValue('a@b.com', 'hash')).not.toBe(maskValue('c@d.com', 'hash'));
  });

  it('tokenizes to tok_ prefixed string', () => {
    const result = maskValue('alice@example.com', 'tokenize', 'key123');
    expect(result).toMatch(/^tok_[0-9a-f]{12}$/);
  });

  it('tokenization is deterministic with same key', () => {
    const a = maskValue('alice@example.com', 'tokenize', 'key123');
    const b = maskValue('alice@example.com', 'tokenize', 'key123');
    expect(a).toBe(b);
  });

  it('tokenization differs with different keys', () => {
    const a = maskValue('alice@example.com', 'tokenize', 'key1');
    const b = maskValue('alice@example.com', 'tokenize', 'key2');
    expect(a).not.toBe(b);
  });
});

// ─── maskEntity ───────────────────────────────────────────────────────────────

describe('maskEntity', () => {
  it('masks auto-detected email field', () => {
    const entity = makeEntity({ email: 'alice@example.com', company: 'Acme' });
    const result = maskEntity(entity, BASE_CONFIG);
    expect(result.attributes['email']).toBe('[REDACTED]');
    expect(result.attributes['company']).toBe('Acme');
  });

  it('records masked fields in _piiMaskedFields', () => {
    const entity = makeEntity({ email: 'alice@example.com', phone: '+1-555-0000' });
    const result = maskEntity(entity, BASE_CONFIG);
    expect(result._piiMaskedFields).toContain('email');
    expect(result._piiMaskedFields).toContain('phone');
  });

  it('skips auto-detection when enableAutoDetection=false', () => {
    const config: WorkspacePiiConfig = { ...BASE_CONFIG, enableAutoDetection: false };
    const entity = makeEntity({ email: 'alice@example.com' });
    const result = maskEntity(entity, config);
    expect(result.attributes['email']).toBe('alice@example.com');
    expect(result._piiMaskedFields).toHaveLength(0);
  });

  it('applies field config over auto-detection', () => {
    const config: WorkspacePiiConfig = {
      ...BASE_CONFIG,
      fieldConfigs: [{ fieldName: 'email', strategy: 'hash' }],
    };
    const entity = makeEntity({ email: 'alice@example.com' });
    const result = maskEntity(entity, config);
    expect(result.attributes['email']).toHaveLength(16); // hash output
  });

  it('applies field config to non-PII field', () => {
    const config: WorkspacePiiConfig = {
      ...BASE_CONFIG,
      enableAutoDetection: false,
      fieldConfigs: [{ fieldName: 'salary', strategy: 'redact' }],
    };
    const entity = makeEntity({ salary: 100000, name: 'Alice' });
    const result = maskEntity(entity, config);
    expect(result.attributes['salary']).toBe('[REDACTED]');
    expect(result.attributes['name']).toBe('Alice');
  });

  it('does not modify non-PII entity', () => {
    const entity = makeEntity({ company: 'Acme', revenue: 50000 });
    const result = maskEntity(entity, BASE_CONFIG);
    expect(result._piiMaskedFields).toHaveLength(0);
    expect(result.attributes).toEqual({ company: 'Acme', revenue: 50000 });
  });

  it('does not mutate the original entity', () => {
    const attrs = { email: 'alice@example.com' };
    const entity = makeEntity(attrs);
    maskEntity(entity, BASE_CONFIG);
    expect(entity.attributes['email']).toBe('alice@example.com');
  });

  it('uses hash strategy when configured', () => {
    const config: WorkspacePiiConfig = { ...BASE_CONFIG, defaultStrategy: 'hash' };
    const entity = makeEntity({ email: 'alice@example.com' });
    const result = maskEntity(entity, config);
    const masked = result.attributes['email'] as string;
    expect(/^[0-9a-f]{16}$/.test(masked)).toBe(true);
  });
});

// ─── maskEntities ─────────────────────────────────────────────────────────────

describe('maskEntities', () => {
  it('masks all entities in array', () => {
    const entities = [
      makeEntity({ email: 'a@b.com' }),
      makeEntity({ email: 'c@d.com' }),
    ];
    const results = maskEntities(entities, BASE_CONFIG);
    expect(results.every(r => r.attributes['email'] === '[REDACTED]')).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(maskEntities([], BASE_CONFIG)).toEqual([]);
  });
});

// ─── PiiConfigService ─────────────────────────────────────────────────────────

function makeSqlMock(rows: Record<string, unknown[]> = {}) {
  // postgres.js returns an array-like Result with `.count` for mutations
  const mutationResult = Object.assign([], { count: 1 });
  return vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join('?');
    if (query.includes('DELETE FROM')) {
      return Promise.resolve(mutationResult);
    }
    if (query.includes('pii_configs WHERE workspace_id')) {
      return Promise.resolve(rows['config'] ?? []);
    }
    if (query.includes('pii_field_configs WHERE workspace_id')) {
      return Promise.resolve(rows['fields'] ?? []);
    }
    return Promise.resolve(mutationResult);
  }) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('PiiConfigService', () => {
  let sql: ReturnType<typeof import('postgres').default>;
  let service: PiiConfigService;

  beforeEach(() => {
    sql = makeSqlMock({
      config: [{
        id: 'cfg-1',
        workspace_id: 'ws1',
        enable_auto_detection: true,
        default_strategy: 'redact' as PiiStrategy,
        tokenization_key: 'tok-key',
      }],
      fields: [{
        id: 'fc-1',
        workspace_id: 'ws1',
        field_name: 'salary',
        strategy: 'hash' as PiiStrategy,
        custom_pattern: null,
      }],
    });
    service = new PiiConfigService(sql);
  });

  it('returns workspace config with field overrides', async () => {
    const result = await service.getConfig('ws1');
    expect(result.isOk()).toBe(true);
    const config = result._unsafeUnwrap();
    expect(config).not.toBeNull();
    expect(config!.workspaceId).toBe('ws1');
    expect(config!.enableAutoDetection).toBe(true);
    expect(config!.fieldConfigs).toHaveLength(1);
    expect(config!.fieldConfigs[0]!.fieldName).toBe('salary');
  });

  it('returns null when no config row exists', async () => {
    const emptySql = makeSqlMock({ config: [], fields: [] });
    const svc = new PiiConfigService(emptySql);
    const result = await svc.getConfig('ws-none');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it('returns err when SQL throws', async () => {
    const broken = vi.fn(() => Promise.reject(new Error('db crash'))) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new PiiConfigService(broken);
    const result = await svc.getConfig('ws1');
    expect(result.isErr()).toBe(true);
  });

  it('upsertConfig succeeds', async () => {
    const result = await service.upsertConfig('ws1', false, 'hash');
    expect(result.isOk()).toBe(true);
  });

  it('upsertFieldConfig succeeds', async () => {
    const result = await service.upsertFieldConfig('ws1', 'phone', 'tokenize');
    expect(result.isOk()).toBe(true);
  });

  it('deleteFieldConfig returns true when count > 0', async () => {
    const result = await service.deleteFieldConfig('ws1', 'salary');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
  });

  it('upsertConfig returns err on SQL failure', async () => {
    const broken = vi.fn(() => Promise.reject(new Error('fail'))) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new PiiConfigService(broken);
    const result = await svc.upsertConfig('ws1', true, 'redact');
    expect(result.isErr()).toBe(true);
  });

  it('upsertFieldConfig returns err on SQL failure', async () => {
    const broken = vi.fn(() => Promise.reject(new Error('fail'))) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new PiiConfigService(broken);
    const result = await svc.upsertFieldConfig('ws1', 'ssn', 'redact');
    expect(result.isErr()).toBe(true);
  });
});
