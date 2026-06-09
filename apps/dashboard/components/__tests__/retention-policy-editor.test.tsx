import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { RetentionPolicyEditor } from '../retention-policy-editor.js';

const POLICY = {
  policyId: 'pol-1',
  connectorId: 'hubspot',
  entityType: 'contact',
  ttlDays: 90,
  isActive: true,
};

describe('RetentionPolicyEditor', () => {
  it('renders the add/update policy form heading', () => {
    render(<RetentionPolicyEditor policies={[]} onSave={vi.fn()} />);
    expect(screen.getByText(/add \/ update policy/i)).toBeInTheDocument();
  });

  it('renders the Save Policy button', () => {
    render(<RetentionPolicyEditor policies={[]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save policy/i })).toBeInTheDocument();
  });

  it('shows "No retention policies" message when policies list is empty', () => {
    render(<RetentionPolicyEditor policies={[]} onSave={vi.fn()} />);
    expect(screen.getByText(/no retention policies configured/i)).toBeInTheDocument();
  });

  it('renders existing policies in table rows', () => {
    render(<RetentionPolicyEditor policies={[POLICY]} onSave={vi.fn()} />);
    // 'hubspot' and 'contact' appear in both select options and table cells
    expect(screen.getAllByText('hubspot').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('contact').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('90d')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders Inactive badge for disabled policy', () => {
    const inactive = { ...POLICY, isActive: false };
    render(<RetentionPolicyEditor policies={[inactive]} onSave={vi.fn()} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('calls onSave with correct values when form is submitted', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RetentionPolicyEditor policies={[]} onSave={onSave} connectors={['hubspot']} entityTypes={['contact']} />);
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      connectorId: 'hubspot',
      entityType: 'contact',
      ttlDays: 90,
      isActive: true,
    }));
  });

  it('shows error message when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('server error'));
    render(<RetentionPolicyEditor policies={[]} onSave={onSave} connectors={['hubspot']} entityTypes={['contact']} />);
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));
    await waitFor(() => expect(screen.getByText(/failed to save policy/i)).toBeInTheDocument());
  });

  it('shows Disable button when onToggle is provided and policy is active', () => {
    render(<RetentionPolicyEditor policies={[POLICY]} onSave={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument();
  });

  it('calls onToggle with inverted isActive when toggle button clicked', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<RetentionPolicyEditor policies={[POLICY]} onSave={vi.fn()} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /disable/i }));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith('pol-1', false));
  });
});
