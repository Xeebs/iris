import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn().mockReturnValue('/'),
}));

import { DashboardLayout } from '../dashboard-layout.js';
import { usePathname } from 'next/navigation';

describe('DashboardLayout', () => {
  it('renders all navigation links', () => {
    render(<DashboardLayout><div>Content</div></DashboardLayout>);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Connectors')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Queries')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Graph')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(<DashboardLayout><p>Hello world</p></DashboardLayout>);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('shows workspace selector when workspaceId is provided', () => {
    render(
      <DashboardLayout workspaceId="ws-123" workspaceName="Acme Corp">
        <div />
      </DashboardLayout>,
    );
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('highlights the active nav link based on pathname', () => {
    vi.mocked(usePathname).mockReturnValue('/connectors');
    render(<DashboardLayout><div /></DashboardLayout>);
    const connectorsLink = screen.getByRole('link', { name: /Connectors/i });
    expect(connectorsLink.className).toContain('indigo');
  });

  it('opens sidebar on mobile menu button click', () => {
    render(<DashboardLayout><div /></DashboardLayout>);
    const menuBtn = screen.getByLabelText('Open menu');
    fireEvent.click(menuBtn);
    // Sidebar should be visible (no -translate-x-full)
    const aside = document.querySelector('aside');
    expect(aside?.className).not.toContain('-translate-x-full');
  });

  it('Overview link goes to /', () => {
    render(<DashboardLayout><div /></DashboardLayout>);
    const overviewLinks = screen.getAllByRole('link', { name: /Overview/ });
    const mainLink = overviewLinks.find((l) => l.getAttribute('href') === '/');
    expect(mainLink).toBeDefined();
  });
});
