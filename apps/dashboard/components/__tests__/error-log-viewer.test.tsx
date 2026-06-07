import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ErrorLogViewer, type SyncLogEntry } from '../error-log-viewer.js';

function makeLog(overrides: Partial<SyncLogEntry> = {}): SyncLogEntry {
  return {
    id: 'log-001',
    syncId: 'sync-abcdef1234',
    eventType: 'completed',
    severity: 'info',
    message: 'Sync completed successfully',
    details: null,
    timestamp: '2026-06-07T12:00:00.000Z',
    ...overrides,
  };
}

describe('ErrorLogViewer', () => {
  it('shows empty state when logs array is empty', () => {
    render(<ErrorLogViewer logs={[]} hasMore={false} onLoadMore={vi.fn()} />);
    expect(screen.getByText('No sync events recorded yet.')).toBeInTheDocument();
  });

  it('renders log message', () => {
    render(<ErrorLogViewer logs={[makeLog({ message: 'Entity sync failed' })]} hasMore={false} onLoadMore={vi.fn()} />);
    expect(screen.getByText('Entity sync failed')).toBeInTheDocument();
  });

  it('renders event type', () => {
    render(<ErrorLogViewer logs={[makeLog({ eventType: 'failed' })]} hasMore={false} onLoadMore={vi.fn()} />);
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('renders last 8 chars of syncId as suffix', () => {
    render(<ErrorLogViewer logs={[makeLog({ syncId: 'sync-abcdef1234' })]} hasMore={false} onLoadMore={vi.fn()} />);
    expect(screen.getByText(/cdef1234/)).toBeInTheDocument();
  });

  it('shows Show details button when details is not null', () => {
    render(<ErrorLogViewer logs={[makeLog({ details: { records: 5 } })]} hasMore={false} onLoadMore={vi.fn()} />);
    expect(screen.getByRole('button', { name: /show details/i })).toBeInTheDocument();
  });

  it('does not show details button when details is null', () => {
    render(<ErrorLogViewer logs={[makeLog({ details: null })]} hasMore={false} onLoadMore={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /show details/i })).not.toBeInTheDocument();
  });

  it('toggles details panel on click', () => {
    render(<ErrorLogViewer logs={[makeLog({ details: { count: 3 } })]} hasMore={false} onLoadMore={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /show details/i }));
    expect(screen.getByRole('button', { name: /hide details/i })).toBeInTheDocument();
    expect(screen.getByText(/"count": 3/)).toBeInTheDocument();
  });

  it('renders Load more button when hasMore is true', () => {
    render(<ErrorLogViewer logs={[makeLog()]} hasMore={true} onLoadMore={vi.fn()} />);
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('does not render Load more when hasMore is false', () => {
    render(<ErrorLogViewer logs={[makeLog()]} hasMore={false} onLoadMore={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('calls onLoadMore when Load more is clicked', () => {
    const onLoadMore = vi.fn();
    render(<ErrorLogViewer logs={[makeLog()]} hasMore={true} onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('disables Load more button and shows Loading… when loading=true', () => {
    render(<ErrorLogViewer logs={[makeLog()]} hasMore={true} onLoadMore={vi.fn()} loading={true} />);
    const btn = screen.getByRole('button', { name: /loading/i });
    expect(btn).toBeDisabled();
  });
});
