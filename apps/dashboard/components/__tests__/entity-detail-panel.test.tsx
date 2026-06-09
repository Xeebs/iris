import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { EntityDetailPanel } from '../entity-detail-panel.js';
import type { GraphNode, GraphEdge } from '@/lib/api';

const NODE: GraphNode = {
  id: 'hubspot:contact:1',
  type: 'contact',
  label: 'Alice Johnson',
  sourceId: 'hubspot:contact:abc-123',
};

const COMPANY_NODE: GraphNode = {
  id: 'hubspot:company:99',
  type: 'company',
  label: 'Acme Corp',
  sourceId: 'hubspot:company:99',
};

const EDGE_OUT: GraphEdge = {
  id: 'e-1',
  source: NODE.id,
  target: COMPANY_NODE.id,
  type: 'works_at',
  confidenceScore: 0.95,
};

const EDGE_IN: GraphEdge = {
  id: 'e-2',
  source: COMPANY_NODE.id,
  target: NODE.id,
  type: 'employs',
  confidenceScore: 0.90,
};

describe('EntityDetailPanel', () => {
  it('returns null when node is null', () => {
    const { container } = render(
      <EntityDetailPanel node={null} edges={[]} allNodes={[]} onClose={vi.fn()} onExpand={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders node label and type badge', () => {
    render(<EntityDetailPanel node={NODE} edges={[]} allNodes={[NODE]} onClose={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('contact')).toBeInTheDocument();
  });

  it('renders source connector id from sourceId prefix', () => {
    render(<EntityDetailPanel node={NODE} edges={[]} allNodes={[NODE]} onClose={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText('hubspot')).toBeInTheDocument();
  });

  it('renders full sourceId', () => {
    render(<EntityDetailPanel node={NODE} edges={[]} allNodes={[NODE]} onClose={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText('hubspot:contact:abc-123')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<EntityDetailPanel node={NODE} edges={[]} allNodes={[NODE]} onClose={onClose} onExpand={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /close detail panel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onExpand with node id when expand button clicked', () => {
    const onExpand = vi.fn();
    render(<EntityDetailPanel node={NODE} edges={[]} allNodes={[NODE]} onClose={vi.fn()} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(onExpand).toHaveBeenCalledWith(NODE.id);
  });

  it('renders outgoing relationship with resolved target label', () => {
    render(
      <EntityDetailPanel node={NODE} edges={[EDGE_OUT]} allNodes={[NODE, COMPANY_NODE]} onClose={vi.fn()} onExpand={vi.fn()} />,
    );
    expect(screen.getByText(/outgoing/i)).toBeInTheDocument();
    expect(screen.getByText('works_at')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('renders incoming relationship with resolved source label', () => {
    render(
      <EntityDetailPanel node={NODE} edges={[EDGE_IN]} allNodes={[NODE, COMPANY_NODE]} onClose={vi.fn()} onExpand={vi.fn()} />,
    );
    expect(screen.getByText(/incoming/i)).toBeInTheDocument();
    expect(screen.getByText('employs')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('shows "no relationships" message when edges is empty', () => {
    render(<EntityDetailPanel node={NODE} edges={[]} allNodes={[NODE]} onClose={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText(/no relationships/i)).toBeInTheDocument();
  });
});
