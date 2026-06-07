import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ApiKeyManager, type ApiKey } from '../api-key-manager.js';

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-001',
    name: 'Test Key',
    keyPrefix: 'iris_',
    scopes: ['query:read'],
    createdAt: '2026-06-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  };
}

describe('ApiKeyManager', () => {
  it('shows empty state message when no API keys', () => {
    render(<ApiKeyManager apiKeys={[]} onCreate={vi.fn()} onRevoke={vi.fn()} />);
    expect(screen.getByText('No API keys yet.')).toBeInTheDocument();
  });

  it('renders API key name', () => {
    render(<ApiKeyManager apiKeys={[makeKey()]} onCreate={vi.fn()} onRevoke={vi.fn()} />);
    expect(screen.getByText('Test Key')).toBeInTheDocument();
  });

  it('renders key prefix with obfuscation suffix', () => {
    render(<ApiKeyManager apiKeys={[makeKey()]} onCreate={vi.fn()} onRevoke={vi.fn()} />);
    expect(screen.getByText(/iris_/)).toBeInTheDocument();
  });

  it('renders scope badges', () => {
    const key = makeKey({ scopes: ['query:read', 'entities:read'] });
    render(<ApiKeyManager apiKeys={[key]} onCreate={vi.fn()} onRevoke={vi.fn()} />);
    expect(screen.getByText('query:read')).toBeInTheDocument();
    expect(screen.getByText('entities:read')).toBeInTheDocument();
  });

  it('shows + Create API Key button initially', () => {
    render(<ApiKeyManager apiKeys={[]} onCreate={vi.fn()} onRevoke={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create api key/i })).toBeInTheDocument();
  });

  it('shows create form when + Create API Key is clicked', () => {
    render(<ApiKeyManager apiKeys={[]} onCreate={vi.fn()} onRevoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    expect(screen.getByPlaceholderText(/claude integration/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows error when creating without a name', async () => {
    render(<ApiKeyManager apiKeys={[]} onCreate={vi.fn()} onRevoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByText('Key name is required.')).toBeInTheDocument();
  });

  it('calls onCreate with trimmed name and selected scopes', async () => {
    const onCreate = vi.fn().mockResolvedValue({ key: 'iris_secret_123' });
    render(<ApiKeyManager apiKeys={[]} onCreate={onCreate} onRevoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.change(screen.getByPlaceholderText(/claude integration/i), {
      target: { value: '  My Key  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('My Key', expect.arrayContaining(['query:read'])),
    );
  });

  it('displays created key after successful creation', async () => {
    const onCreate = vi.fn().mockResolvedValue({ key: 'iris_abc123' });
    render(<ApiKeyManager apiKeys={[]} onCreate={onCreate} onRevoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.change(screen.getByPlaceholderText(/claude integration/i), {
      target: { value: 'My Key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByText('iris_abc123')).toBeInTheDocument();
  });

  it('dismisses created key banner on Dismiss click', async () => {
    const onCreate = vi.fn().mockResolvedValue({ key: 'iris_abc123' });
    render(<ApiKeyManager apiKeys={[]} onCreate={onCreate} onRevoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.change(screen.getByPlaceholderText(/claude integration/i), {
      target: { value: 'My Key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await screen.findByText('iris_abc123');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('iris_abc123')).not.toBeInTheDocument();
  });

  it('calls onRevoke with the key id when Revoke is clicked', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    render(<ApiKeyManager apiKeys={[makeKey()]} onCreate={vi.fn()} onRevoke={onRevoke} />);
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith('key-001'));
  });

  it('shows error message when onCreate rejects', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('Server error'));
    render(<ApiKeyManager apiKeys={[]} onCreate={onCreate} onRevoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.change(screen.getByPlaceholderText(/claude integration/i), {
      target: { value: 'Bad Key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByText('Server error')).toBeInTheDocument();
  });

  it('cancels form and clears error on Cancel click', () => {
    render(<ApiKeyManager apiKeys={[]} onCreate={vi.fn()} onRevoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByPlaceholderText(/claude integration/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Key name is required.')).not.toBeInTheDocument();
  });
});
