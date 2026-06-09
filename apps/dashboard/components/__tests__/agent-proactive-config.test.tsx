import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { AgentProactiveConfig } from '../agent-proactive-config.js';

const PROFILE = {
  agentId: 'agent-1',
  frequentEntityTypes: ['contact', 'deal'],
  queryPatterns: { 'recent deals': 5, 'contacts': 3 },
  totalQueries: 120,
  learnedAt: '2026-06-01T00:00:00Z',
};

const STATS = {
  total: 50,
  accepted: 35,
  ignored: 10,
  modified: 5,
  acceptanceRate: 0.7,
};

const SUGGESTIONS = [
  {
    id: 'sug-1',
    entityTypes: ['deal'],
    contextHints: ['Recent closed deals', 'Top accounts'],
    score: 0.85,
  },
];

function mockFetchAll() {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: PROFILE }) })    // profile
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: SUGGESTIONS }) }) // preview
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: STATS }) });      // stats
}

describe('AgentProactiveConfig', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchAll());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Proactive Context Settings heading', () => {
    render(<AgentProactiveConfig workspaceId="ws-1" agentId="agent-1" />);
    expect(screen.getByText(/proactive context settings/i)).toBeInTheDocument();
  });

  it('renders aggressiveness select with default medium', () => {
    render(<AgentProactiveConfig workspaceId="ws-1" agentId="agent-1" />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('medium');
  });

  it('changes aggressiveness when select changes', () => {
    render(<AgentProactiveConfig workspaceId="ws-1" agentId="agent-1" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high' } });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('high');
  });

  it('renders Save Settings button', () => {
    render(<AgentProactiveConfig workspaceId="ws-1" agentId="agent-1" />);
    expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
  });

  it('renders behavioral profile after fetch', async () => {
    render(<AgentProactiveConfig workspaceId="ws-1" agentId="agent-1" />);
    await waitFor(() => expect(screen.getByText(/behavioral profile/i)).toBeInTheDocument());
    expect(screen.getByText('contact')).toBeInTheDocument();
    // 'deal' may appear in both the profile and suggestions sections
    expect(screen.getAllByText('deal').length).toBeGreaterThanOrEqual(1);
  });

  it('renders suggestion performance stats', async () => {
    render(<AgentProactiveConfig workspaceId="ws-1" agentId="agent-1" />);
    await waitFor(() => expect(screen.getByText(/suggestion performance/i)).toBeInTheDocument());
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('calls save settings API when Save button clicked', async () => {
    const fetchMock = mockFetchAll();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentProactiveConfig workspaceId="ws-1" agentId="agent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/proactive-settings'),
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('renders context preview suggestions when available', async () => {
    render(<AgentProactiveConfig workspaceId="ws-1" agentId="agent-1" />);
    await waitFor(() => expect(screen.getByText(/context preview/i)).toBeInTheDocument());
    // hint rendered as "• Recent closed deals" inside a <li>
    expect(screen.getByText(/recent closed deals/i)).toBeInTheDocument();
  });
});
