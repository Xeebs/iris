import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkspaceSettingsPage from '../page.js';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const MOCK_WS = {
  id: 'ws-test',
  name: 'Test Workspace',
  ownerEmail: 'owner@example.com',
  plan: 'Pro',
  createdAt: '2026-01-01T00:00:00Z',
  entityCount: 1234,
  queryCount: 567,
  entityLimit: 10000,
  queryLimit: 50000,
};

const MOCK_MEMBERS = [
  { id: 'm1', email: 'alice@example.com', role: 'owner' as const, joinedAt: '2026-01-01T00:00:00Z' },
  { id: 'm2', email: 'bob@example.com', role: 'member' as const, joinedAt: '2026-02-01T00:00:00Z' },
];

const MOCK_KEYS = [
  {
    id: 'k1',
    name: 'Claude integration',
    keyPrefix: 'iris_',
    scopes: ['query:read', 'entities:read'],
    createdAt: '2026-01-15T00:00:00Z',
    lastUsedAt: '2026-06-01T00:00:00Z',
  },
];

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(responses).find((k) => url.includes(k));
    const data = key ? responses[key] : null;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data }),
    });
  });
}

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    global.fetch = mockFetch({
      'workspace/settings': MOCK_WS,
      'workspace/members': MOCK_MEMBERS,
      'mcp-api-keys': MOCK_KEYS,
    });
  });

  it('renders workspace info tab by default', async () => {
    render(<WorkspaceSettingsPage params={{ workspaceId: 'ws-test' }} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.getByText('Test Workspace')).toBeInTheDocument();
    expect(screen.getAllByText('ws-test').length).toBeGreaterThan(0);
  });

  it('shows all navigation tabs', async () => {
    render(<WorkspaceSettingsPage params={{ workspaceId: 'ws-test' }} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.getByText('Basic Info')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('API Keys')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Data & Privacy')).toBeInTheDocument();
  });

  it('switches to team tab and shows members', async () => {
    render(<WorkspaceSettingsPage params={{ workspaceId: 'ws-test' }} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('Team'));
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('switches to API keys tab and shows key list', async () => {
    render(<WorkspaceSettingsPage params={{ workspaceId: 'ws-test' }} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('API Keys'));
    expect(screen.getByText('Claude integration')).toBeInTheDocument();
  });

  it('switches to billing tab and shows plan', async () => {
    render(<WorkspaceSettingsPage params={{ workspaceId: 'ws-test' }} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('Billing'));
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('shows error state when workspace fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    render(<WorkspaceSettingsPage params={{ workspaceId: 'ws-bad' }} />);
    await waitFor(() => expect(screen.getByText(/failed|error/i)).toBeInTheDocument());
  });
});
