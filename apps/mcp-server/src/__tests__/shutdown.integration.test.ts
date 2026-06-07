import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

import { registerGracefulShutdown } from '../shutdown.js';

function captureProcessListeners() {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const origOn = process.on.bind(process);
  vi.spyOn(process, 'on').mockImplementation((event, handler) => {
    listeners[event as string] = handler as (...args: unknown[]) => void;
    return process;
  });
  return { listeners, origOn };
}

describe('registerGracefulShutdown', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('registers handlers for SIGTERM and SIGINT', () => {
    const { listeners } = captureProcessListeners();
    registerGracefulShutdown(vi.fn().mockResolvedValue(undefined));
    expect(listeners['SIGTERM']).toBeDefined();
    expect(listeners['SIGINT']).toBeDefined();
  });

  it('calls onShutdown when SIGTERM fires', async () => {
    const { listeners } = captureProcessListeners();
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    registerGracefulShutdown(onShutdown);
    await (listeners['SIGTERM'] as () => Promise<void>)();

    expect(onShutdown).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('calls onShutdown when SIGINT fires', async () => {
    const { listeners } = captureProcessListeners();
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    registerGracefulShutdown(onShutdown);
    await (listeners['SIGINT'] as () => Promise<void>)();

    expect(onShutdown).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits with code 1 when onShutdown throws', async () => {
    const { listeners } = captureProcessListeners();
    const onShutdown = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    registerGracefulShutdown(onShutdown);
    await (listeners['SIGTERM'] as () => Promise<void>)();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not call onShutdown twice on repeated signals', async () => {
    const { listeners } = captureProcessListeners();
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    registerGracefulShutdown(onShutdown);
    const handler = listeners['SIGTERM'] as () => Promise<void>;
    await Promise.all([handler(), handler()]);

    expect(onShutdown).toHaveBeenCalledOnce();
  });
});
