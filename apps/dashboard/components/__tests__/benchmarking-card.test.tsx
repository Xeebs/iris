import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { BenchmarkingCard } from '../benchmarking-card.js';

vi.mock('../benchmark-comparison-chart.js', () => ({
  BenchmarkComparisonChart: () => <div data-testid="benchmark-chart" />,
}));

const BASE_SETTINGS = {
  workspaceId: 'ws-1',
  benchmarkingEnabled: false,
  industry: null,
  companySize: null,
};

const BASE_METRICS = {
  entityCount: 1200,
  queryCount: 340,
  avgContextSizeTokens: 800,
  tokenSavingsRatio: 0.62,
  cacheHitRate: 0.45,
  snapshotAt: '2026-06-01T00:00:00Z',
};

const BASE_REPORT = {
  workspaceId: 'ws-1',
  metrics: BASE_METRICS,
  peerComparisons: [],
  peerCount: 0,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: BASE_SETTINGS }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BenchmarkingCard', () => {
  it('renders the section heading', () => {
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={BASE_SETTINGS} />);
    expect(screen.getByText('Peer Benchmarks')).toBeInTheDocument();
  });

  it('shows Share data checkbox unchecked when benchmarking disabled', () => {
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={BASE_SETTINGS} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  it('shows Share data checkbox checked when benchmarking enabled', () => {
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={{ ...BASE_SETTINGS, benchmarkingEnabled: true }} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('shows metric tiles when report is provided', () => {
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={BASE_SETTINGS} initialReport={BASE_REPORT} />);
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('62.0%')).toBeInTheDocument();
    expect(screen.getByText('45.0%')).toBeInTheDocument();
  });

  it('shows placeholder when no report', () => {
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={BASE_SETTINGS} />);
    expect(screen.queryByText('1,200')).not.toBeInTheDocument();
    expect(screen.getByText(/no snapshot/i)).toBeInTheDocument();
  });

  it('calls PUT API when opt-in toggled', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: BASE_SETTINGS }) });
    vi.stubGlobal('fetch', mockFetch);
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={BASE_SETTINGS} />);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('settings'),
      expect.objectContaining({ method: 'PUT' }),
    ));
  });

  it('shows error when API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('API down')));
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={BASE_SETTINGS} />);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(screen.getByText('API down')).toBeInTheDocument());
  });

  it('renders Refresh button', () => {
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={BASE_SETTINGS} />);
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('shows peer count when comparisons available', () => {
    const report = { ...BASE_REPORT, peerCount: 42, peerComparisons: [{ metric: 'tokenSavingsRatio', workspaceValue: 0.6, peerPercentiles: { p25: 0.4, p50: 0.5, p75: 0.65, p90: 0.8 }, percentileRank: 72 }] };
    render(<BenchmarkingCard workspaceId="ws-1" initialSettings={BASE_SETTINGS} initialReport={report} />);
    expect(screen.getByText(/42 peer/i)).toBeInTheDocument();
  });
});
