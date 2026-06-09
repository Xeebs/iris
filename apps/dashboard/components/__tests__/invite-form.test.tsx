import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { InviteForm } from '../invite-form.js';

describe('InviteForm', () => {
  it('renders the User ID input field', () => {
    render(<InviteForm />);
    expect(screen.getByLabelText(/user id or email/i)).toBeInTheDocument();
  });

  it('renders the Role select field', () => {
    render(<InviteForm />);
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument();
  });

  it('renders Send Invite button', () => {
    render(<InviteForm />);
    expect(screen.getByRole('button', { name: /send invite/i })).toBeInTheDocument();
  });

  it('button is disabled when userId is empty', () => {
    render(<InviteForm />);
    expect(screen.getByRole('button', { name: /send invite/i })).toBeDisabled();
  });

  it('shows required validation error when form submitted with empty userId', async () => {
    const onInvite = vi.fn();
    const { container } = render(<InviteForm onInvite={onInvite} />);
    // Submit the form directly — button is disabled for empty input but form event still fires
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onInvite).not.toHaveBeenCalled();
  });

  it('calls onInvite with userId and role on valid submit', async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined);
    render(<InviteForm onInvite={onInvite} />);
    fireEvent.change(screen.getByLabelText(/user id or email/i), { target: { value: 'user@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /send invite/i }).closest('form')!);
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith('user@example.com', 'viewer'));
  });

  it('shows success message after successful invite', async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined);
    render(<InviteForm onInvite={onInvite} />);
    fireEvent.change(screen.getByLabelText(/user id or email/i), { target: { value: 'user@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /send invite/i }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByText(/invitation sent successfully/i)).toBeInTheDocument();
  });

  it('shows error message when onInvite rejects', async () => {
    const onInvite = vi.fn().mockRejectedValue(new Error('Email already exists'));
    render(<InviteForm onInvite={onInvite} />);
    fireEvent.change(screen.getByLabelText(/user id or email/i), { target: { value: 'user@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /send invite/i }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Email already exists')).toBeInTheDocument();
  });

  it('clears userId field after successful invite', async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined);
    render(<InviteForm onInvite={onInvite} />);
    const input = screen.getByLabelText(/user id or email/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'user@example.com' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(input.value).toBe('');
  });
});
