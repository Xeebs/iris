import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncDiagnosticsService } from '../sync-diagnostics.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const DIAG_ROW = {
  id: 'diag-uuid-1',
  sync_job_id: 'job-1',
  connector_instance_id: 'hs-inst-1',
  workspace_id: 'ws-1',
  error_category: 'auth_failure',
  error_message: 'Unauthorized: invalid token',
  error_details: {},
  recovery_suggestions: [{ action: 'reauthorize', description: 'Re-authorize', automated: false }],
  is_resolved: false,
  resolved_at: null,
  created_at: '2024-01-01T00:00:00Z',
};

describe('SyncDiagnosticsService', () => {
  let sql: ReturnType<typeof vi.fn>;
  let service: SyncDiagnosticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = vi.fn(async () => [DIAG_ROW]);
    service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
  });

  describe('categorizeError', () => {
    it('classifies 401 as auth_failure', () => {
      expect(service.categorizeError('HTTP 401 Unauthorized')).toBe('auth_failure');
    });

    it('classifies "invalid token" as auth_failure', () => {
      expect(service.categorizeError('Request failed: invalid token')).toBe('auth_failure');
    });

    it('classifies 429 as rate_limit', () => {
      expect(service.categorizeError('HTTP 429 Too Many Requests')).toBe('rate_limit');
    });

    it('classifies throttle message as rate_limit', () => {
      expect(service.categorizeError('API throttled: reduce request rate')).toBe('rate_limit');
    });

    it('classifies timeout as network_timeout', () => {
      expect(service.categorizeError('Connection timeout after 10000ms')).toBe('network_timeout');
    });

    it('classifies ETIMEDOUT as network_timeout', () => {
      expect(service.categorizeError('ETIMEDOUT: connection refused')).toBe('network_timeout');
    });

    it('classifies schema errors', () => {
      expect(service.categorizeError('Unknown field: custom_field_xyz')).toBe('schema_mismatch');
    });

    it('classifies validation errors', () => {
      expect(service.categorizeError('Validation error: required field missing')).toBe('data_validation');
    });

    it('classifies quota_exceeded', () => {
      expect(service.categorizeError('quota_exceeded: monthly limit reached')).toBe('rate_limit');
    });

    it('defaults to unknown for unrecognized errors', () => {
      expect(service.categorizeError('Something went wrong unexpectedly')).toBe('unknown');
    });
  });

  describe('generateRecoveryPlan', () => {
    it('returns suggestions for auth_failure', () => {
      const plan = service.generateRecoveryPlan('auth_failure');
      expect(plan.length).toBeGreaterThan(0);
      expect(plan.some((s) => s.action === 'reauthorize')).toBe(true);
    });

    it('returns suggestions for rate_limit', () => {
      const plan = service.generateRecoveryPlan('rate_limit');
      expect(plan.some((s) => s.action === 'wait_retry')).toBe(true);
    });

    it('returns automated suggestion for network_timeout', () => {
      const plan = service.generateRecoveryPlan('network_timeout');
      const automated = plan.find((s) => s.automated);
      expect(automated).toBeDefined();
    });

    it('returns non-empty plan for all categories', () => {
      const categories = ['auth_failure', 'rate_limit', 'network_timeout', 'schema_mismatch', 'data_validation', 'quota_exceeded', 'unknown'] as const;
      for (const cat of categories) {
        expect(service.generateRecoveryPlan(cat).length).toBeGreaterThan(0);
      }
    });
  });

  describe('recordDiagnostic', () => {
    it('categorizes and persists a diagnostic', async () => {
      const result = await service.recordDiagnostic('job-1', 'inst-1', 'ws-1', 'HTTP 401 Unauthorized');
      expect(result.isOk()).toBe(true);
      const diag = result._unsafeUnwrap();
      expect(diag.errorCategory).toBe('auth_failure');
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('DB failure'));
      service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
      const result = await service.recordDiagnostic('j', 'i', 'w', 'error');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getDiagnostics', () => {
    it('returns list of diagnostics', async () => {
      const result = await service.getDiagnostics('hs-inst-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });

    it('returns empty array when none found', async () => {
      sql = vi.fn(async () => []);
      service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
      const result = await service.getDiagnostics('inst-none');
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('analyzeConnectorHealth', () => {
    it('returns healthy when no diagnostics', async () => {
      sql = vi.fn(async () => []);
      service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
      const health = await service.analyzeConnectorHealth('inst-1');
      expect(health.healthStatus).toBe('healthy');
      expect(health.errorRate).toBe(0);
    });

    it('returns failing when all syncs are errors', async () => {
      const failRows = Array.from({ length: 8 }, () => ({ ...DIAG_ROW, is_resolved: false }));
      sql = vi.fn(async () => failRows);
      service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
      const health = await service.analyzeConnectorHealth('inst-1');
      expect(health.healthStatus).toBe('failing');
      expect(health.errorRate).toBeGreaterThan(0.5);
    });

    it('identifies dominant category', async () => {
      const failRows = Array.from({ length: 5 }, () => ({
        ...DIAG_ROW, error_category: 'auth_failure', is_resolved: false,
      }));
      sql = vi.fn(async () => failRows);
      service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
      const health = await service.analyzeConnectorHealth('inst-1');
      expect(health.dominantCategory).toBe('auth_failure');
      expect(health.patterns.some((p) => p.includes('auth'))).toBe(true);
    });

    it('returns healthy when db errors occur', async () => {
      sql = vi.fn().mockRejectedValue(new Error('DB error'));
      service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
      const health = await service.analyzeConnectorHealth('inst-1');
      expect(health.healthStatus).toBe('healthy');
    });
  });

  describe('resolve', () => {
    it('marks diagnostic as resolved', async () => {
      sql = vi.fn(async () => []);
      service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
      const result = await service.resolve('diag-uuid-1');
      expect(result.isOk()).toBe(true);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('update failed'));
      service = new SyncDiagnosticsService(sql as unknown as Parameters<typeof SyncDiagnosticsService>[0]);
      const result = await service.resolve('diag-uuid-1');
      expect(result.isErr()).toBe(true);
    });
  });
});
