import { describe, it, expect, vi } from 'vitest';
import {
  EmailService,
  buildInviteEmail,
} from '../email-service.js';
import type { EmailMessage, SendResult } from '../email-service.js';

const config = {
  apiKey: 'SG.test-key',
  fromEmail: 'noreply@iris.ai',
  fromName: 'Iris',
};

const successTransport = vi.fn(
  async (_payload: Record<string, unknown>, _apiKey: string): Promise<SendResult> => ({
    messageId: 'test-msg-id',
    accepted: ['recipient@example.com'],
  }),
);

const failingTransport = vi.fn(
  async (): Promise<SendResult> => {
    throw new Error('SMTP connection refused');
  },
);

describe('EmailService', () => {
  describe('send()', () => {
    it('returns ok with messageId on success', async () => {
      const svc = new EmailService(config, successTransport);

      const result = await svc.send({
        to: { email: 'recipient@example.com', name: 'Recipient' },
        subject: 'Test email',
        html: '<p>Hello</p>',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.messageId).toBe('test-msg-id');
        expect(result.value.accepted).toContain('recipient@example.com');
      }
    });

    it('calls transport with correct payload structure', async () => {
      const transport = vi.fn().mockResolvedValue({ messageId: 'id', accepted: ['a@b.com'] });
      const svc = new EmailService(config, transport);

      await svc.send({
        to: { email: 'a@b.com' },
        subject: 'Hello',
        html: '<p>Test</p>',
        text: 'Test',
      });

      const [payload, apiKey] = transport.mock.calls[0] as [Record<string, unknown>, string];
      expect(apiKey).toBe('SG.test-key');
      const personalizations = payload['personalizations'] as Array<{ to: unknown[]; subject: string }>;
      expect(personalizations[0]!.to).toHaveLength(1);
      expect(personalizations[0]!.subject).toBe('Hello');
    });

    it('accepts an array of recipients', async () => {
      const transport = vi.fn().mockResolvedValue({ messageId: 'id', accepted: ['a@b.com', 'c@d.com'] });
      const svc = new EmailService(config, transport);

      const result = await svc.send({
        to: [{ email: 'a@b.com' }, { email: 'c@d.com' }],
        subject: 'Batch email',
        html: '<p>Hello everyone</p>',
      });

      expect(result.isOk()).toBe(true);
    });

    it('returns err when transport throws', async () => {
      const svc = new EmailService(config, failingTransport);

      const result = await svc.send({
        to: { email: 'x@y.com' },
        subject: 'Fail test',
        html: '<p>X</p>',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('SMTP connection refused');
      }
    });

    it('includes both html and text in payload when text provided', async () => {
      const transport = vi.fn().mockResolvedValue({ messageId: 'id', accepted: [] });
      const svc = new EmailService(config, transport);

      await svc.send({
        to: { email: 'a@b.com' },
        subject: 'With text',
        html: '<p>HTML</p>',
        text: 'Plain text',
      });

      const [payload] = transport.mock.calls[0] as [Record<string, unknown>];
      const content = payload['content'] as Array<{ type: string; value: string }>;
      expect(content.some((c) => c.type === 'text/plain')).toBe(true);
      expect(content.some((c) => c.type === 'text/html')).toBe(true);
    });
  });
});

describe('buildInviteEmail', () => {
  it('includes inviter name, workspace name, and invite URL', () => {
    const result = buildInviteEmail('Alice', 'Acme Corp', 'https://iris.ai/accept/abc');

    expect(result.subject).toContain('Acme Corp');
    expect(result.html).toContain('Alice');
    expect(result.html).toContain('Acme Corp');
    expect(result.html).toContain('https://iris.ai/accept/abc');
    expect(result.text).toContain('https://iris.ai/accept/abc');
  });

  it('sets subject with workspace name', () => {
    const result = buildInviteEmail('Bob', 'MyWorkspace', 'https://example.com/invite');
    expect(result.subject).toContain('MyWorkspace');
  });

  it('returns non-empty html and text', () => {
    const result = buildInviteEmail('Charlie', 'Test Corp', 'https://example.com/invite');
    expect(result.html.length).toBeGreaterThan(50);
    expect((result.text ?? '').length).toBeGreaterThan(20);
  });
});
