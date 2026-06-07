import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../email-service.js';

vi.mock('../logger.js', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const config = {
  apiKey: 'SG.integration-test-key',
  fromEmail: 'alerts@iris.ai',
  fromName: 'Iris',
};

function makeFetchMock(status: number, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
    text: vi.fn().mockResolvedValue(''),
  });
}

describe('EmailService (SendGrid integration)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends email and returns messageId from X-Message-Id header', async () => {
    globalThis.fetch = makeFetchMock(202, { 'X-Message-Id': 'sg-abc123' });
    const svc = new EmailService(config);

    const result = await svc.send({
      to: { email: 'user@example.com', name: 'Test User' },
      subject: 'Integration test',
      html: '<p>Hello</p>',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().messageId).toBe('sg-abc123');
    expect(result._unsafeUnwrap().accepted).toContain('user@example.com');
  });

  it('sends the correct Authorization header', async () => {
    const mockFetch = makeFetchMock(202, { 'X-Message-Id': 'sg-xyz' });
    globalThis.fetch = mockFetch;
    const svc = new EmailService(config);

    await svc.send({ to: { email: 'a@b.com' }, subject: 'Test', html: '<p>X</p>' });

    const [, fetchInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((fetchInit.headers as Record<string, string>)['Authorization']).toBe('Bearer SG.integration-test-key');
  });

  it('sends to the SendGrid v3 mail/send endpoint', async () => {
    const mockFetch = makeFetchMock(202, { 'X-Message-Id': 'sg-xyz' });
    globalThis.fetch = mockFetch;
    const svc = new EmailService(config);

    await svc.send({ to: { email: 'a@b.com' }, subject: 'Test', html: '<p>X</p>' });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
  });

  it('retries on 429 rate-limit and succeeds on retry', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, headers: { get: () => '0' }, text: vi.fn().mockResolvedValue('') };
      }
      return { ok: true, status: 202, headers: { get: (n: string) => (n === 'X-Message-Id' ? 'sg-retry' : null) }, text: vi.fn().mockResolvedValue('') };
    });

    vi.useFakeTimers();
    const sendPromise = new EmailService(config).send({ to: { email: 'x@y.com' }, subject: 'Retry test', html: '<p>X</p>' });
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.isOk()).toBe(true);
    expect(callCount).toBe(2);
    vi.useRealTimers();
  });

  it('retries on 503 server error', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false, status: 503, headers: { get: () => null }, text: vi.fn().mockResolvedValue('Service Unavailable') };
      }
      return { ok: true, status: 202, headers: { get: (n: string) => (n === 'X-Message-Id' ? 'sg-ok' : null) }, text: vi.fn().mockResolvedValue('') };
    });

    vi.useFakeTimers();
    const sendPromise = new EmailService(config).send({ to: { email: 'x@y.com' }, subject: 'Server error retry', html: '<p>X</p>' });
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.isOk()).toBe(true);
    expect(callCount).toBe(3);
    vi.useRealTimers();
  });

  it('returns err after max retries exhausted', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: vi.fn().mockResolvedValue('Service Unavailable'),
    });

    vi.useFakeTimers();
    const sendPromise = new EmailService(config).send({ to: { email: 'x@y.com' }, subject: 'Max retries', html: '<p>X</p>' });
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.isErr()).toBe(true);
    vi.useRealTimers();
  });

  it('returns err immediately for 400 bad request (non-retryable)', async () => {
    globalThis.fetch = makeFetchMock(400);
    const svc = new EmailService(config);

    const result = await svc.send({ to: { email: 'bad' }, subject: 'Bad', html: '<p>X</p>' });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('400');
  });

  it('generates a fallback messageId if X-Message-Id is absent', async () => {
    globalThis.fetch = makeFetchMock(202);
    const svc = new EmailService(config);

    const result = await svc.send({ to: { email: 'a@b.com' }, subject: 'Fallback ID', html: '<p>X</p>' });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().messageId).toMatch(/^sg-\d+$/);
  });
});
