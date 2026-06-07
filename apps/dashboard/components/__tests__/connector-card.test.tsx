import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ConnectorCard } from '../connector-card.js';

const BASE = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM contacts, companies, and deals',
  icon: 'hubspot.svg',
  entityTypes: ['contact', 'company', 'deal'],
  auth: { type: 'oauth2' as const, scopes: ['contacts'] },
  configSchema: {},
  rateLimits: { requestsPerSecond: 10 },
};

describe('ConnectorCard', () => {
  it('renders the connector name', () => {
    render(<ConnectorCard connector={BASE} />);
    expect(screen.getByText('HubSpot')).toBeInTheDocument();
  });

  it('renders the connector description', () => {
    render(<ConnectorCard connector={BASE} />);
    expect(screen.getByText('CRM contacts, companies, and deals')).toBeInTheDocument();
  });

  it('renders all entity type badges', () => {
    render(<ConnectorCard connector={BASE} />);
    expect(screen.getByText('contact')).toBeInTheDocument();
    expect(screen.getByText('company')).toBeInTheDocument();
    expect(screen.getByText('deal')).toBeInTheDocument();
  });

  it('shows Active status badge', () => {
    render(<ConnectorCard connector={BASE} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders with a single entity type', () => {
    render(<ConnectorCard connector={{ ...BASE, entityTypes: ['file'] }} />);
    expect(screen.getByText('file')).toBeInTheDocument();
  });

  it('renders with no entity types gracefully', () => {
    render(<ConnectorCard connector={{ ...BASE, entityTypes: [] }} />);
    expect(screen.getByText('HubSpot')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('renders a different connector without error', () => {
    const notion = { ...BASE, id: 'notion', name: 'Notion', description: 'Sync databases and pages', entityTypes: ['database', 'page'] };
    render(<ConnectorCard connector={notion} />);
    expect(screen.getByText('Notion')).toBeInTheDocument();
    expect(screen.getByText('Sync databases and pages')).toBeInTheDocument();
  });

  it('renders entity type badges inside a container', () => {
    const { container } = render(<ConnectorCard connector={BASE} />);
    const badges = container.querySelectorAll('span.rounded-md');
    expect(badges.length).toBe(3);
  });
});
