import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { HealthStatusBadge } from '../health-status-badge.js';

describe('HealthStatusBadge', () => {
  it('renders Healthy label for healthy status', () => {
    render(<HealthStatusBadge status="healthy" />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders Degraded label for degraded status', () => {
    render(<HealthStatusBadge status="degraded" />);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders Unhealthy label for unhealthy status', () => {
    render(<HealthStatusBadge status="unhealthy" />);
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
  });

  it('renders Unknown label for unknown status', () => {
    render(<HealthStatusBadge status="unknown" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('applies green color classes for healthy', () => {
    const { container } = render(<HealthStatusBadge status="healthy" />);
    const badge = container.querySelector('span.inline-flex');
    expect(badge?.className).toContain('green');
  });

  it('applies yellow color classes for degraded', () => {
    const { container } = render(<HealthStatusBadge status="degraded" />);
    const badge = container.querySelector('span.inline-flex');
    expect(badge?.className).toContain('yellow');
  });

  it('applies red color classes for unhealthy', () => {
    const { container } = render(<HealthStatusBadge status="unhealthy" />);
    const badge = container.querySelector('span.inline-flex');
    expect(badge?.className).toContain('red');
  });

  it('applies gray color classes for unknown', () => {
    const { container } = render(<HealthStatusBadge status="unknown" />);
    const badge = container.querySelector('span.inline-flex');
    expect(badge?.className).toContain('gray');
  });

  it('uses smaller padding for sm size', () => {
    const { container } = render(<HealthStatusBadge status="healthy" size="sm" />);
    const badge = container.querySelector('span.inline-flex');
    expect(badge?.className).toContain('px-2');
  });

  it('uses larger padding for md size (default)', () => {
    const { container } = render(<HealthStatusBadge status="healthy" />);
    const badge = container.querySelector('span.inline-flex');
    expect(badge?.className).toContain('px-3');
  });
});
