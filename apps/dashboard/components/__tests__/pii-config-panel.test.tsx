import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { PiiConfigPanel } from '../pii-config-panel.js';

const BASE_CONFIG = {
  workspaceId: 'ws-1',
  enableAutoDetection: true,
  defaultStrategy: 'redact' as const,
  fieldConfigs: [],
};

const noop = vi.fn();

describe('PiiConfigPanel', () => {
  it('renders the section heading', () => {
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={null} onSave={noop} onAddField={noop} onDeleteField={noop} />);
    expect(screen.getByText('PII & Data Masking')).toBeInTheDocument();
  });

  it('renders auto-detection checkbox', () => {
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={BASE_CONFIG} onSave={noop} onAddField={noop} onDeleteField={noop} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('renders auto-detection checkbox unchecked when disabled', () => {
    const config = { ...BASE_CONFIG, enableAutoDetection: false };
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={config} onSave={noop} onAddField={noop} onDeleteField={noop} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('shows field config entries when present', () => {
    const config = { ...BASE_CONFIG, fieldConfigs: [{ fieldName: 'email', strategy: 'hash' as const }] };
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={config} onSave={noop} onAddField={noop} onDeleteField={noop} />);
    expect(screen.getByText('email')).toBeInTheDocument();
  });

  it('calls onSave when Save settings is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={BASE_CONFIG} onSave={onSave} onAddField={noop} onDeleteField={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('calls onSave with correct data when auto-detect toggled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={BASE_CONFIG} onSave={onSave} onAddField={noop} onDeleteField={noop} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ enableAutoDetection: false, defaultStrategy: 'redact' }));
  });

  it('calls onAddField with field details when Add is clicked', async () => {
    const onAddField = vi.fn().mockResolvedValue(undefined);
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={BASE_CONFIG} onSave={noop} onAddField={onAddField} onDeleteField={noop} />);
    const input = screen.getByPlaceholderText(/field name/i);
    fireEvent.change(input, { target: { value: 'ssn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onAddField).toHaveBeenCalledWith(expect.objectContaining({ fieldName: 'ssn' })));
  });

  it('calls onDeleteField when Remove is clicked', async () => {
    const onDeleteField = vi.fn().mockResolvedValue(undefined);
    const config = { ...BASE_CONFIG, fieldConfigs: [{ fieldName: 'phone', strategy: 'redact' as const }] };
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={config} onSave={noop} onAddField={noop} onDeleteField={onDeleteField} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onDeleteField).toHaveBeenCalledWith('phone'));
  });

  it('shows error when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={BASE_CONFIG} onSave={onSave} onAddField={noop} onDeleteField={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(screen.getByText('Save failed')).toBeInTheDocument());
  });

  it('displays strategy buttons for all three strategies', () => {
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={BASE_CONFIG} onSave={noop} onAddField={noop} onDeleteField={noop} />);
    const strategyButtons = screen.getAllByRole('button').filter(b =>
      b.textContent?.includes('Redact') || b.textContent?.includes('Hash') || b.textContent?.includes('Tokenize')
    );
    expect(strategyButtons.length).toBe(3);
  });

  it('Add button is disabled when field name is empty', () => {
    render(<PiiConfigPanel workspaceId="ws-1" initialConfig={BASE_CONFIG} onSave={noop} onAddField={noop} onDeleteField={noop} />);
    const addBtn = screen.getByRole('button', { name: 'Add' });
    expect(addBtn).toBeDisabled();
  });
});
