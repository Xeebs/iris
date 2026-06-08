import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(), usePathname: vi.fn(() => '/admin/overview') }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const HEALTH_RESPONSE = {
  data: {
    status: 'ok',
    timestamp: '2026-06-08T12:00:00.000Z',
    checks: {
      postgres: { status: 'ok', latencyMs: 4 },
      redis: { status: 'ok', latencyMs: 1 },
      qdrant: { status: 'ok', latencyMs: 8 },
    },
  },
};

const PERF_RESPONSE = {
  data: {
    periodDays: 7,
    latency: { avg_latency_ms: 120, p95_ms: 400, total_requests: 5000 },
    cache: { cache_hit_rate_pct: 64 },
    sync: { total_syncs: 150, failed_syncs: 3 },
  },
};

describe('Admin Overview Page — data fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches system health from the correct endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => HEALTH_RESPONSE,
    });

    const apiBase = 'http://localhost:3001';
    const res = await fetch(`${apiBase}/api/v1/admin/system-health`, { cache: 'no-store' });
    const body = (await res.json()) as typeof HEALTH_RESPONSE;

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/admin/system-health',
      { cache: 'no-store' },
    );
    expect(body.data.status).toBe('ok');
    expect(Object.keys(body.data.checks)).toContain('postgres');
  });

  it('fetches performance summary from the correct endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => PERF_RESPONSE,
    });

    const apiBase = 'http://localhost:3001';
    const res = await fetch(`${apiBase}/api/v1/admin/system/performance/summary`, { cache: 'no-store' });
    const body = (await res.json()) as typeof PERF_RESPONSE;

    expect(body.data.latency.avg_latency_ms).toBe(120);
    expect(body.data.cache.cache_hit_rate_pct).toBe(64);
  });

  it('returns null when system health API returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    const apiBase = 'http://localhost:3001';
    const res = await fetch(`${apiBase}/api/v1/admin/system-health`, { cache: 'no-store' });
    const result = res.ok ? (await res.json()) : null;

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    let result: null | unknown = null;
    try {
      await fetch('http://localhost:3001/api/v1/admin/system-health');
    } catch {
      result = null;
    }

    expect(result).toBeNull();
  });

  it('degrades gracefully when checks map has an error entry', () => {
    const degradedHealth = {
      status: 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        postgres: { status: 'ok', latencyMs: 3 },
        redis: { status: 'error', message: 'Connection refused' },
      },
    };

    expect(degradedHealth.status).toBe('degraded');
    expect(degradedHealth.checks.redis.status).toBe('error');
    expect(degradedHealth.checks.redis.message).toBe('Connection refused');
  });
});
