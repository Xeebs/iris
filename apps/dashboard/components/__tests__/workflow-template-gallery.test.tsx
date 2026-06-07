import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { WorkflowTemplateGallery, type WorkflowTemplate } from '../workflow-template-gallery.js';

function makeTemplate(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id: 'tpl-1',
    workspaceId: 'ws-1',
    templateName: 'Daily Sales Summary',
    description: 'Summarises daily revenue and lead pipeline.',
    triggerType: 'calendar',
    triggerConfig: { cron: '0 9 * * *' },
    mcpCalls: [{ tool: 'query-context', params: { query: 'sales' } }],
    responseFormat: 'text',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const noop = vi.fn();

describe('WorkflowTemplateGallery', () => {
  it('shows empty state when no templates', () => {
    render(<WorkflowTemplateGallery templates={[]} onSelect={noop} onDelete={noop} onToggleActive={noop} />);
    expect(screen.getByText(/no workflow templates/i)).toBeInTheDocument();
  });

  it('renders template name and description', () => {
    render(<WorkflowTemplateGallery templates={[makeTemplate()]} onSelect={noop} onDelete={noop} onToggleActive={noop} />);
    expect(screen.getByText('Daily Sales Summary')).toBeInTheDocument();
    expect(screen.getByText('Summarises daily revenue and lead pipeline.')).toBeInTheDocument();
  });

  it('shows Active badge for active templates', () => {
    render(<WorkflowTemplateGallery templates={[makeTemplate({ isActive: true })]} onSelect={noop} onDelete={noop} onToggleActive={noop} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows Inactive badge for inactive templates', () => {
    render(<WorkflowTemplateGallery templates={[makeTemplate({ isActive: false })]} onSelect={noop} onDelete={noop} onToggleActive={noop} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('displays trigger type label', () => {
    render(<WorkflowTemplateGallery templates={[makeTemplate({ triggerType: 'manual' })]} onSelect={noop} onDelete={noop} onToggleActive={noop} />);
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('displays MCP step count', () => {
    const tmpl = makeTemplate({ mcpCalls: [{ tool: 'query-context', params: {} }, { tool: 'list-entities', params: {} }] });
    render(<WorkflowTemplateGallery templates={[tmpl]} onSelect={noop} onDelete={noop} onToggleActive={noop} />);
    expect(screen.getByText('2 steps')).toBeInTheDocument();
  });

  it('calls onSelect when Edit is clicked', () => {
    const onSelect = vi.fn();
    render(<WorkflowTemplateGallery templates={[makeTemplate()]} onSelect={onSelect} onDelete={noop} onToggleActive={noop} />);
    fireEvent.click(screen.getAllByText('Edit')[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onDelete when Delete is clicked', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<WorkflowTemplateGallery templates={[makeTemplate()]} onSelect={noop} onDelete={onDelete} onToggleActive={noop} />);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('tpl-1'));
  });

  it('calls onToggleActive when Disable is clicked', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<WorkflowTemplateGallery templates={[makeTemplate({ isActive: true })]} onSelect={noop} onDelete={noop} onToggleActive={onToggle} />);
    fireEvent.click(screen.getByText('Disable'));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith('tpl-1', false));
  });

  it('shows error message when delete fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<WorkflowTemplateGallery templates={[makeTemplate()]} onSelect={noop} onDelete={onDelete} onToggleActive={noop} />);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });

  it('renders multiple templates', () => {
    const templates = [makeTemplate(), makeTemplate({ id: 'tpl-2', templateName: 'Weekly Finance Review' })];
    render(<WorkflowTemplateGallery templates={templates} onSelect={noop} onDelete={noop} onToggleActive={noop} />);
    expect(screen.getByText('Daily Sales Summary')).toBeInTheDocument();
    expect(screen.getByText('Weekly Finance Review')).toBeInTheDocument();
  });
});
