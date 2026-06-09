import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BillingCard } from '../billing-card.js';

const BASE = {
  plan: 'Starter',
  entityCount: 500,
  queryCount: 200,
  entityLimit: 1000,
  queryLimit: 500,
  onUpgrade: vi.fn(),
};

describe('BillingCard', () => {
  it('renders current plan name', () => {
    render(<BillingCard {...BASE} />);
    expect(screen.getByText('Starter')).toBeInTheDocument();
  });

  it('shows "Upgrade to Pro" button for non-pro plan', () => {
    render(<BillingCard {...BASE} />);
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeInTheDocument();
  });

  it('calls onUpgrade when upgrade button clicked', () => {
    const onUpgrade = vi.fn();
    render(<BillingCard {...BASE} onUpgrade={onUpgrade} />);
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('does not show upgrade button for Pro plan', () => {
    render(<BillingCard {...BASE} plan="Pro" />);
    expect(screen.queryByRole('button', { name: /upgrade to pro/i })).not.toBeInTheDocument();
  });

  it('does not show upgrade button for Enterprise plan', () => {
    render(<BillingCard {...BASE} plan="Enterprise" />);
    expect(screen.queryByRole('button', { name: /upgrade to pro/i })).not.toBeInTheDocument();
  });

  it('renders Indexed Entities usage bar label', () => {
    render(<BillingCard {...BASE} />);
    expect(screen.getByText('Indexed Entities')).toBeInTheDocument();
  });

  it('renders MCP Queries usage bar label', () => {
    render(<BillingCard {...BASE} />);
    expect(screen.getByText('MCP Queries (this month)')).toBeInTheDocument();
  });

  it('shows upgrade promo banner for non-pro plans', () => {
    render(<BillingCard {...BASE} />);
    expect(screen.getByText(/upgrade to pro for unlimited/i)).toBeInTheDocument();
  });

  it('does not show promo banner for Pro plan', () => {
    render(<BillingCard {...BASE} plan="Pro" />);
    expect(screen.queryByText(/upgrade to pro for unlimited/i)).not.toBeInTheDocument();
  });
});
