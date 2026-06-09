import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { DlqInspector } from '../dlq-inspector.js';
import type { DlqEntry } from '../dlq-inspector.js';

const ENTRY: DlqEntry = {
  id: 'dlq-1',
  jobId: 'job-abc-123',
  connectorInstanceId: 'connector-xyz-456',
  workspaceId: 'ws-1',
  errorMessage: 'Connection refused',
  errorStack: 'Error: Connection refused\n  at connect (line 1)',
  attemptCount: 3,
  jobData: { connectorInstanceId: 'connector-xyz-456', workspaceId: 'ws-1', triggeredAt: '2026-06-09T10:00:00Z' },
  createdAt: '2026-06-09T10:00:00Z',
  retriedAt: null,
  retriedBy: null,
};

const RETRIED_ENTRY: DlqEntry = {
  ...ENTRY,
  id: 'dlq-2',
  retriedAt: '2026-06-09T11:00:00Z',
  retriedBy: 'admin-user',
};

describe('DlqInspector', () => {
  it('shows empty message when no entries', () => {
    render(<DlqInspector entries={[]} hasMore={false} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/no dead letter queue entries/i)).toBeInTheDocument();
  });

  it('renders entry error message in table', () => {
    render(<DlqInspector entries={[ENTRY]} hasMore={false} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('renders attempt count badge', () => {
    render(<DlqInspector entries={[ENTRY]} hasMore={false} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows Pending status for unretried entry', () => {
    render(<DlqInspector entries={[ENTRY]} hasMore={false} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('shows Retried status for already-retried entry', () => {
    render(<DlqInspector entries={[RETRIED_ENTRY]} hasMore={false} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/retried/i)).toBeInTheDocument();
  });

  it('calls onRetry with entry id when Retry button clicked', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<DlqInspector entries={[ENTRY]} hasMore={false} onLoadMore={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith('dlq-1'));
  });

  it('disables Retry button for already-retried entries', () => {
    render(<DlqInspector entries={[RETRIED_ENTRY]} hasMore={false} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Done' });
    expect(btn).toBeDisabled();
  });

  it('expands row to show stack trace on row click', () => {
    render(<DlqInspector entries={[ENTRY]} hasMore={false} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByText('Connection refused'));
    expect(screen.getByText(/stack trace/i)).toBeInTheDocument();
  });

  it('renders Load more button when hasMore is true', () => {
    render(<DlqInspector entries={[ENTRY]} hasMore={true} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('calls onLoadMore when Load more is clicked', () => {
    const onLoadMore = vi.fn();
    render(<DlqInspector entries={[ENTRY]} hasMore={true} onLoadMore={onLoadMore} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
