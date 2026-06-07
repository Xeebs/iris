import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertsService } from '../alerts.js';
import type { AlertNotifier } from '../alerts.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn((..._args: unknown[]) => Promise.resolve([]));
}

const mockNotifier: AlertNotifier = { send: vi.fn().mockResolvedValue(undefined) };

const ruleRow = {
  id: 'rule-1',
  workspace_id: 'ws-1',
  name: 'Sync failure alert',
  condition: 'sync_failure',
  threshold: 3,
  enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const channelRow = {
  id: 'chan-1',
  workspace_id: 'ws-1',
  name: 'Slack ops',
  type: 'slack',
  config: { webhookUrl: 'https://hooks.slack.com/test' },
  is_default: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('AlertsService', () => {
  let sql: ReturnType<typeof makeSql>;
  let svc: AlertsService;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSql();
    svc = new AlertsService(sql as unknown as Parameters<typeof AlertsService>[0], mockNotifier);
  });

  describe('listRules', () => {
    it('returns mapped alert rules', async () => {
      sql.mockResolvedValueOnce([ruleRow]);
      const result = await svc.listRules('ws-1');
      expect(result.isOk()).toBe(true);
      const rules = result._unsafeUnwrap();
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-1');
      expect(rules[0]?.condition).toBe('sync_failure');
    });

    it('returns ok([]) when no rules exist', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await svc.listRules('ws-empty');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('db down'));
      const result = await svc.listRules('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('createRule', () => {
    it('inserts and returns new rule', async () => {
      sql.mockResolvedValueOnce([ruleRow]);
      const result = await svc.createRule('ws-1', {
        name: 'Sync failure alert',
        condition: 'sync_failure',
        threshold: 3,
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().name).toBe('Sync failure alert');
    });

    it('returns err when insert returns no rows', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await svc.createRule('ws-1', { name: 'x', condition: 'token_quota', threshold: 1000 });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('deleteRule', () => {
    it('executes delete and returns ok', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await svc.deleteRule('ws-1', 'rule-1');
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledOnce();
    });

    it('returns err on db error', async () => {
      sql.mockRejectedValueOnce(new Error('constraint violation'));
      const result = await svc.deleteRule('ws-1', 'rule-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('createChannel', () => {
    it('inserts and returns new channel', async () => {
      sql.mockResolvedValueOnce([channelRow]);
      const result = await svc.createChannel('ws-1', {
        name: 'Slack ops',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        isDefault: true,
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().type).toBe('slack');
    });
  });

  describe('deleteChannel', () => {
    it('deletes channel and returns ok', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await svc.deleteChannel('ws-1', 'chan-1');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('evaluateRules', () => {
    it('fires notifier when metric exceeds threshold', async () => {
      // listRules
      sql.mockResolvedValueOnce([ruleRow]);
      // listChannels
      sql.mockResolvedValueOnce([channelRow]);
      // fetchMetric (sync_failure count = 5)
      sql.mockResolvedValueOnce([{ cnt: 5 }]);
      // sendAlert → insert event
      sql.mockResolvedValueOnce([]);

      const result = await svc.evaluateRules('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);
      expect(mockNotifier.send).toHaveBeenCalledOnce();
    });

    it('does not fire when metric is below threshold', async () => {
      sql.mockResolvedValueOnce([ruleRow]);
      sql.mockResolvedValueOnce([channelRow]);
      sql.mockResolvedValueOnce([{ cnt: 1 }]); // below threshold of 3

      const result = await svc.evaluateRules('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
      expect(mockNotifier.send).not.toHaveBeenCalled();
    });

    it('returns ok(0) when no enabled rules exist', async () => {
      sql.mockResolvedValueOnce([{ ...ruleRow, enabled: false }]);
      sql.mockResolvedValueOnce([channelRow]);

      const result = await svc.evaluateRules('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
    });
  });

  describe('listEvents', () => {
    it('returns recent alert events', async () => {
      const eventRow = {
        id: 'evt-1',
        workspace_id: 'ws-1',
        rule_id: 'rule-1',
        channel_id: 'chan-1',
        status: 'delivered',
        payload: { value: 5 },
        error_message: null,
        sent_at: new Date().toISOString(),
      };
      sql.mockResolvedValueOnce([eventRow]);
      const result = await svc.listEvents('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });
  });
});
