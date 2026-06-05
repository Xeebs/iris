import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../logger.js';

describe('logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    delete process.env['LOG_LEVEL'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('info', () => {
    it('writes a JSON entry to stdout', () => {
      logger.info('test message');
      expect(stdoutSpy).toHaveBeenCalledOnce();
      const entry = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
      expect(entry).toMatchObject({ level: 'info', message: 'test message' });
      expect(entry['timestamp']).toBeDefined();
    });

    it('includes structured metadata in output', () => {
      logger.info('sync complete', { connectorId: 'hubspot', recordCount: 42 });
      const entry = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
      expect(entry['connectorId']).toBe('hubspot');
      expect(entry['recordCount']).toBe(42);
    });
  });

  describe('error', () => {
    it('writes to stderr instead of stdout', () => {
      logger.error('something broke');
      expect(stderrSpy).toHaveBeenCalledOnce();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  describe('sensitive key scrubbing', () => {
    it('redacts token fields', () => {
      logger.info('auth', { accessToken: 'secret-value', userId: 'u1' });
      const entry = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
      expect(entry['accessToken']).toBe('[REDACTED]');
      expect(entry['userId']).toBe('u1');
    });

    it('redacts password fields', () => {
      logger.info('connect', { password: 'hunter2', host: 'localhost' });
      const entry = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
      expect(entry['password']).toBe('[REDACTED]');
      expect(entry['host']).toBe('localhost');
    });

    it('redacts email fields', () => {
      logger.info('user event', { email: 'test@example.com', action: 'login' });
      const entry = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
      expect(entry['email']).toBe('[REDACTED]');
    });
  });

  describe('child logger', () => {
    it('inherits context from parent', () => {
      const child = logger.child({ connectorId: 'salesforce' });
      child.info('page fetched', { page: 2 });
      const entry = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
      expect(entry['connectorId']).toBe('salesforce');
      expect(entry['page']).toBe(2);
    });

    it('does not leak child context to parent', () => {
      const child = logger.child({ requestId: 'req-1' });
      child.info('child event');
      stdoutSpy.mockClear();
      logger.info('parent event');
      const entry = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
      expect(entry['requestId']).toBeUndefined();
    });
  });

  describe('log level filtering', () => {
    it('suppresses debug messages when LOG_LEVEL=info', () => {
      process.env['LOG_LEVEL'] = 'info';
      logger.debug('this should be suppressed');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('shows debug messages when LOG_LEVEL=debug', () => {
      process.env['LOG_LEVEL'] = 'debug';
      logger.debug('verbose trace');
      expect(stdoutSpy).toHaveBeenCalledOnce();
      const entry = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
      expect(entry['level']).toBe('debug');
    });
  });
});
