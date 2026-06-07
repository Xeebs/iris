import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailTemplateService, extractVariables, interpolate } from '../email-templates.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const TEMPLATE_ROW = {
  id: 'tmpl-1',
  workspace_id: 'ws-1',
  name: 'alert-default',
  subject: 'Alert: {{alertName}}',
  html_body: '<p>{{message}}</p>',
  text_body: '{{message}}',
  variables: ['alertName', 'message'],
  is_default: false,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

describe('extractVariables', () => {
  it('extracts unique variable names from template string', () => {
    const vars = extractVariables('Hello {{name}}, your {{item}} is ready, {{name}}!');
    expect(vars).toEqual(['name', 'item']);
  });

  it('returns empty array for template with no variables', () => {
    expect(extractVariables('No variables here')).toHaveLength(0);
  });

  it('handles multiple variables in one template', () => {
    expect(extractVariables('{{a}} and {{b}} and {{c}}')).toHaveLength(3);
  });
});

describe('interpolate', () => {
  it('substitutes variables in template', () => {
    const result = interpolate('Hello {{name}}!', { name: 'Alice' });
    expect(result).toBe('Hello Alice!');
  });

  it('leaves unknown variables as-is', () => {
    const result = interpolate('Hello {{name}}!', {});
    expect(result).toBe('Hello {{name}}!');
  });

  it('handles multiple variables', () => {
    const result = interpolate('{{a}} + {{b}} = {{c}}', { a: '1', b: '2', c: '3' });
    expect(result).toBe('1 + 2 = 3');
  });

  it('replaces repeated variables', () => {
    const result = interpolate('{{x}} and {{x}}', { x: 'hello' });
    expect(result).toBe('hello and hello');
  });
});

describe('EmailTemplateService', () => {
  let sql: ReturnType<typeof vi.fn>;
  let service: EmailTemplateService;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = vi.fn(async () => [TEMPLATE_ROW]);
    service = new EmailTemplateService(sql as never);
  });

  describe('create', () => {
    it('inserts and returns a template', async () => {
      const result = await service.create('ws-1', {
        name: 'alert-default',
        subject: 'Alert: {{alertName}}',
        htmlBody: '<p>{{message}}</p>',
        textBody: '{{message}}',
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().name).toBe('alert-default');
    });

    it('auto-extracts variables when not provided', async () => {
      await service.create('ws-1', {
        name: 'test',
        subject: 'Hello {{name}}',
        htmlBody: '<p>{{body}}</p>',
        textBody: '{{body}}',
      });
      expect(sql).toHaveBeenCalled();
    });

    it('returns err when SQL throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('unique violation'));
      service = new EmailTemplateService(sql as never);
      const result = await service.create('ws-1', { name: 'dup', subject: 's', htmlBody: 'h', textBody: 't' });
      expect(result.isErr()).toBe(true);
    });

    it('returns err when insert returns no rows', async () => {
      sql = vi.fn(async () => []);
      service = new EmailTemplateService(sql as never);
      const result = await service.create('ws-1', { name: 'x', subject: 's', htmlBody: 'h', textBody: 't' });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('upsert', () => {
    it('upserts and returns the template', async () => {
      const result = await service.upsert('ws-1', {
        name: 'alert-default',
        subject: 'Updated subject',
        htmlBody: '<p>Updated</p>',
        textBody: 'Updated',
      });
      expect(result.isOk()).toBe(true);
    });

    it('returns err on SQL error', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error'));
      service = new EmailTemplateService(sql as never);
      const result = await service.upsert('ws-1', { name: 'x', subject: 's', htmlBody: 'h', textBody: 't' });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('list', () => {
    it('returns all templates for workspace', async () => {
      sql = vi.fn(async () => [TEMPLATE_ROW, { ...TEMPLATE_ROW, id: 'tmpl-2', name: 'b' }]);
      service = new EmailTemplateService(sql as never);
      const result = await service.list('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('returns empty array when none exist', async () => {
      sql = vi.fn(async () => []);
      service = new EmailTemplateService(sql as never);
      const result = await service.list('ws-1');
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('returns template when found', async () => {
      const result = await service.get('ws-1', 'tmpl-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()?.id).toBe('tmpl-1');
    });

    it('returns null when not found', async () => {
      sql = vi.fn(async () => []);
      service = new EmailTemplateService(sql as never);
      const result = await service.get('ws-1', 'missing');
      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes template and returns ok', async () => {
      sql = vi.fn(async () => []);
      service = new EmailTemplateService(sql as never);
      const result = await service.delete('ws-1', 'tmpl-1');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('render', () => {
    it('renders template with variable substitution', async () => {
      const result = await service.render('ws-1', 'tmpl-1', {
        alertName: 'High CPU',
        message: 'CPU usage exceeded 90%',
      });
      expect(result.isOk()).toBe(true);
      const rendered = result._unsafeUnwrap();
      expect(rendered.subject).toBe('Alert: High CPU');
      expect(rendered.htmlBody).toBe('<p>CPU usage exceeded 90%</p>');
    });

    it('returns err when template not found', async () => {
      sql = vi.fn(async () => []);
      service = new EmailTemplateService(sql as never);
      const result = await service.render('ws-1', 'missing-id', {});
      expect(result.isErr()).toBe(true);
    });

    it('renders default template when no templateId given', async () => {
      const defaultRow = { ...TEMPLATE_ROW, is_default: true };
      sql = vi.fn(async () => [defaultRow]);
      service = new EmailTemplateService(sql as never);
      const result = await service.render('ws-1', null, { alertName: 'test', message: 'body' });
      expect(result.isOk()).toBe(true);
    });
  });
});
