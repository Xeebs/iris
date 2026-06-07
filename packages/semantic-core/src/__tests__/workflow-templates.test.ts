import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';
import { WorkflowTemplateService, STARTER_TEMPLATES } from '../workflow-templates.js';
import type { WorkflowTemplate } from '../workflow-templates.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const WORKSPACE = 'ws-test';
const TEMPLATE_ID = 'tmpl-1';

const FAKE_ROW = {
  id: TEMPLATE_ID,
  workspace_id: WORKSPACE,
  template_name: 'Daily Sales Summary',
  description: 'Summarize daily sales',
  trigger_type: 'calendar' as const,
  trigger_config: { cron: '0 9 * * 1-5' },
  mcp_calls: [{ tool: 'query-context', params: { query: 'deals', topK: 10 } }],
  response_format: 'markdown' as const,
  is_active: true,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

const EXPECTED_TEMPLATE: WorkflowTemplate = {
  id: TEMPLATE_ID,
  workspaceId: WORKSPACE,
  templateName: 'Daily Sales Summary',
  description: 'Summarize daily sales',
  triggerType: 'calendar',
  triggerConfig: { cron: '0 9 * * 1-5' },
  mcpCalls: [{ tool: 'query-context', params: { query: 'deals', topK: 10 } }],
  responseFormat: 'markdown',
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

/** Creates a mock sql tag function that returns `rows` for SELECT/INSERT/UPDATE queries
 *  and an inert object for fragment calls (empty template strings). */
function makeSql(rows: unknown[][]) {
  const queue = [...rows];
  const sql = new Proxy(
    function sql(strings: TemplateStringsArray, ..._values: unknown[]) {
      const joined = strings.join('');
      if (
        !joined.includes('SELECT') &&
        !joined.includes('INSERT') &&
        !joined.includes('UPDATE') &&
        !joined.includes('DELETE') &&
        !joined.includes('FROM')
      ) {
        return { strings, values: _values };
      }
      const next = queue.shift();
      if (next === undefined) throw new Error('makeSql: no more queued results');
      return Promise.resolve(
        Object.assign(next, { count: (next as unknown[]).length }),
      );
    },
    {
      apply(target, thisArg, args) {
        return (target as Function)(...args);
      },
    },
  ) as unknown as Parameters<typeof WorkflowTemplateService>[0];
  return sql;
}

describe('WorkflowTemplateService', () => {
  describe('createTemplate', () => {
    it('returns the created template on success', async () => {
      const sql = makeSql([[FAKE_ROW]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.createTemplate(WORKSPACE, {
        templateName: 'Daily Sales Summary',
        description: 'Summarize daily sales',
        triggerType: 'calendar',
        triggerConfig: { cron: '0 9 * * 1-5' },
        mcpCalls: [{ tool: 'query-context', params: { query: 'deals', topK: 10 } }],
        responseFormat: 'markdown',
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchObject({
        id: TEMPLATE_ID,
        workspaceId: WORKSPACE,
        templateName: 'Daily Sales Summary',
        triggerType: 'calendar',
      });
    });

    it('returns err when no row returned', async () => {
      const sql = makeSql([[]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.createTemplate(WORKSPACE, {
        templateName: 'Test',
        mcpCalls: [{ tool: 'query-context', params: {} }],
      });
      expect(result.isErr()).toBe(true);
    });

    it('returns err on SQL error', async () => {
      const sql = new Proxy(
        function () { return Promise.reject(new Error('DB error')); },
        { apply: (t, _, a) => (t as Function)(...a) },
      ) as unknown as Parameters<typeof WorkflowTemplateService>[0];
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.createTemplate(WORKSPACE, {
        templateName: 'Test',
        mcpCalls: [{ tool: 'query-context', params: {} }],
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('DB error');
    });

    it('rejects input with empty mcpCalls array', async () => {
      const sql = makeSql([]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.createTemplate(WORKSPACE, {
        templateName: 'Bad Template',
        mcpCalls: [],
      });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listTemplates', () => {
    it('returns all templates for a workspace', async () => {
      const sql = makeSql([[FAKE_ROW]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.listTemplates(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });

    it('returns empty array when no templates', async () => {
      const sql = makeSql([[]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.listTemplates(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('handles activeOnly=true', async () => {
      const sql = makeSql([[FAKE_ROW]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.listTemplates(WORKSPACE, true);
      expect(result.isOk()).toBe(true);
    });

    it('returns err on SQL error', async () => {
      const sql = new Proxy(
        function sql(strings: TemplateStringsArray) {
          const joined = strings.join('');
          if (!joined.includes('SELECT') && !joined.includes('FROM') && !joined.includes('INSERT') && !joined.includes('UPDATE') && !joined.includes('DELETE')) {
            return { strings };
          }
          return Promise.reject(new Error('timeout'));
        },
        { apply: (t, _, a) => (t as Function)(...a) },
      ) as unknown as Parameters<typeof WorkflowTemplateService>[0];
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.listTemplates(WORKSPACE);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getTemplate', () => {
    it('returns the template when found', async () => {
      const sql = makeSql([[FAKE_ROW]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.getTemplate(WORKSPACE, TEMPLATE_ID);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()?.id).toBe(TEMPLATE_ID);
    });

    it('returns null when not found', async () => {
      const sql = makeSql([[]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.getTemplate(WORKSPACE, 'nonexistent');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  describe('updateTemplate', () => {
    it('returns updated template', async () => {
      const updated = { ...FAKE_ROW, template_name: 'Renamed', updated_at: new Date() };
      const sql = makeSql([[updated]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.updateTemplate(WORKSPACE, TEMPLATE_ID, { templateName: 'Renamed' });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()?.templateName).toBe('Renamed');
    });

    it('returns null when template not found', async () => {
      const sql = makeSql([[]]);
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.updateTemplate(WORKSPACE, 'bad-id', { templateName: 'X' });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  describe('deleteTemplate', () => {
    it('returns true when deleted', async () => {
      const result_obj = Object.assign([], { count: 1 });
      const sql = new Proxy(
        function () { return Promise.resolve(result_obj); },
        { apply: (t, _, a) => (t as Function)(...a) },
      ) as unknown as Parameters<typeof WorkflowTemplateService>[0];
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.deleteTemplate(WORKSPACE, TEMPLATE_ID);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns false when not found', async () => {
      const result_obj = Object.assign([], { count: 0 });
      const sql = new Proxy(
        function () { return Promise.resolve(result_obj); },
        { apply: (t, _, a) => (t as Function)(...a) },
      ) as unknown as Parameters<typeof WorkflowTemplateService>[0];
      const svc = new WorkflowTemplateService(sql);
      const result = await svc.deleteTemplate(WORKSPACE, 'bad-id');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });
  });

  describe('STARTER_TEMPLATES', () => {
    it('has 3 starter templates', () => {
      expect(STARTER_TEMPLATES).toHaveLength(3);
    });

    it('each starter template has at least one mcpCall', () => {
      for (const t of STARTER_TEMPLATES) {
        expect(t.mcpCalls.length).toBeGreaterThan(0);
      }
    });

    it('all trigger types are valid', () => {
      const valid = new Set(['manual', 'calendar', 'entity_change']);
      for (const t of STARTER_TEMPLATES) {
        expect(valid.has(t.triggerType)).toBe(true);
      }
    });
  });
});
