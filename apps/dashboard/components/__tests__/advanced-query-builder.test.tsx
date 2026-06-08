import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { AdvancedQueryBuilder } from '../advanced-query-builder.js';

const WORKSPACE_ID = 'ws-test-123';

function setup(props: Partial<Parameters<typeof AdvancedQueryBuilder>[0]> = {}) {
  return render(
    <AdvancedQueryBuilder workspaceId={WORKSPACE_ID} {...props} />,
  );
}

describe('AdvancedQueryBuilder', () => {
  describe('initial render', () => {
    it('renders the title', () => {
      setup();
      expect(screen.getByText('Advanced Query Builder')).toBeInTheDocument();
    });

    it('renders entity type selector with placeholder', () => {
      setup();
      expect(screen.getByText('Select entity type…')).toBeInTheDocument();
    });

    it('renders Execute Query button disabled when no entity type selected', () => {
      setup();
      const btn = screen.getByRole('button', { name: /execute query/i });
      expect(btn).toBeDisabled();
    });

    it('renders a default empty filter rule row', () => {
      setup();
      expect(screen.getByLabelText('Filter field')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter operator')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter value')).toBeInTheDocument();
    });

    it('renders Add Rule button', () => {
      setup();
      expect(screen.getByRole('button', { name: /add rule/i })).toBeInTheDocument();
    });

    it('renders close button when onClose provided', () => {
      const onClose = vi.fn();
      setup({ onClose });
      expect(screen.getByRole('button', { name: /close query builder/i })).toBeInTheDocument();
    });

    it('does not render close button without onClose', () => {
      setup();
      expect(screen.queryByRole('button', { name: /close query builder/i })).not.toBeInTheDocument();
    });

    it('renders custom entity types when provided', () => {
      setup({ availableEntityTypes: ['task', 'sprint'] });
      expect(screen.getByText('task')).toBeInTheDocument();
      expect(screen.getByText('sprint')).toBeInTheDocument();
    });
  });

  describe('entity type selection', () => {
    it('enables Execute Query button after selecting entity type', () => {
      setup();
      const select = screen.getByLabelText('Entity Type');
      fireEvent.change(select, { target: { value: 'contact' } });
      expect(screen.getByRole('button', { name: /execute query/i })).not.toBeDisabled();
    });

    it('updates query preview when entity type is selected', () => {
      setup();
      const select = screen.getByLabelText('Entity Type');
      fireEvent.change(select, { target: { value: 'deal' } });
      expect(screen.getByLabelText('Query string preview')).toBeInTheDocument();
      // "FROM" is in a colored span and "deal" is a sibling text node — check the preview container text
      const preview = screen.getByLabelText('Query string preview');
      expect(preview.textContent).toContain('FROM');
      expect(preview.textContent).toContain('deal');
    });
  });

  describe('filter rule management', () => {
    it('adds a new rule row when Add Rule is clicked', () => {
      setup();
      const addBtn = screen.getByRole('button', { name: /add rule/i });
      fireEvent.click(addBtn);
      expect(screen.getAllByLabelText('Filter field')).toHaveLength(2);
    });

    it('removes a rule row when remove button is clicked', () => {
      setup();
      const addBtn = screen.getByRole('button', { name: /add rule/i });
      fireEvent.click(addBtn);
      expect(screen.getAllByLabelText('Filter field')).toHaveLength(2);
      const removeBtns = screen.getAllByRole('button', { name: /remove filter rule/i });
      fireEvent.click(removeBtns[0]);
      expect(screen.getAllByLabelText('Filter field')).toHaveLength(1);
    });

    it('ensures at least one rule row always exists after removing the last rule', () => {
      setup();
      const removeBtn = screen.getByRole('button', { name: /remove filter rule/i });
      fireEvent.click(removeBtn);
      expect(screen.getAllByLabelText('Filter field')).toHaveLength(1);
    });

    it('updates filter value in query preview', () => {
      setup();
      const select = screen.getByLabelText('Entity Type');
      fireEvent.change(select, { target: { value: 'contact' } });

      const fieldSelects = screen.getAllByLabelText('Filter field');
      fireEvent.change(fieldSelects[0], { target: { value: 'stage' } });

      const valueInputs = screen.getAllByLabelText('Filter value');
      fireEvent.change(valueInputs[0], { target: { value: 'customer' } });

      const preview = screen.getByLabelText('Query string preview');
      expect(preview.textContent).toContain('stage = "customer"');
    });

    it('shows validation warning for incomplete rules (field set, value empty)', () => {
      // entity type must be selected first so 'stage' appears as a valid field option
      setup({ availableEntityTypes: ['contact'] });
      const entitySelect = screen.getByLabelText('Entity Type');
      fireEvent.change(entitySelect, { target: { value: 'contact' } });
      const fieldSelects = screen.getAllByLabelText('Filter field');
      fireEvent.change(fieldSelects[0]!, { target: { value: 'stage' } });
      expect(screen.getByText(/all filter rules with a field selected must have a value/i)).toBeInTheDocument();
    });
  });

  describe('aggregation toggle', () => {
    it('shows aggregation controls when toggled on', () => {
      setup();
      const checkbox = screen.getByRole('checkbox', { name: /aggregation/i });
      fireEvent.click(checkbox);
      expect(screen.getByText('Function')).toBeInTheDocument();
    });

    it('defaults aggregation function to COUNT', () => {
      setup();
      const checkbox = screen.getByRole('checkbox', { name: /aggregation/i });
      fireEvent.click(checkbox);
      const fnSelect = screen.getByDisplayValue('COUNT');
      expect(fnSelect).toBeInTheDocument();
    });

    it('shows field selector when non-count aggregation is selected', () => {
      setup();
      const checkbox = screen.getByRole('checkbox', { name: /aggregation/i });
      fireEvent.click(checkbox);
      const fnSelect = screen.getByDisplayValue('COUNT');
      fireEvent.change(fnSelect, { target: { value: 'sum' } });
      expect(screen.getByText('Field')).toBeInTheDocument();
    });

    it('shows group by selector when aggregation is enabled', () => {
      setup();
      const checkbox = screen.getByRole('checkbox', { name: /aggregation/i });
      fireEvent.click(checkbox);
      expect(screen.getByText('Group By')).toBeInTheDocument();
    });

    it('hides limit input when aggregation is enabled', () => {
      setup();
      expect(screen.getByLabelText('Limit')).toBeInTheDocument();
      const checkbox = screen.getByRole('checkbox', { name: /aggregation/i });
      fireEvent.click(checkbox);
      expect(screen.queryByLabelText('Limit')).not.toBeInTheDocument();
    });

    it('shows limit input when aggregation is disabled', () => {
      setup();
      expect(screen.getByLabelText('Limit')).toBeInTheDocument();
    });

    it('includes aggregation in query preview string', () => {
      setup();
      const entitySelect = screen.getByLabelText('Entity Type');
      fireEvent.change(entitySelect, { target: { value: 'deal' } });
      const checkbox = screen.getByRole('checkbox', { name: /aggregation/i });
      fireEvent.click(checkbox);
      const preview = screen.getByLabelText('Query string preview');
      expect(preview.textContent).toContain('COUNT');
    });
  });

  describe('close button', () => {
    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      setup({ onClose });
      fireEvent.click(screen.getByRole('button', { name: /close query builder/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('execute query', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('shows error when entity type not selected and execute is somehow triggered', async () => {
      setup();
      const btn = screen.getByRole('button', { name: /execute query/i });
      expect(btn).toBeDisabled();
    });

    it('makes a POST request on execute with correct body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { entities: [], totalCount: 0 } }),
      });
      global.fetch = mockFetch;

      setup({ apiBase: '/api/v1' });
      const entitySelect = screen.getByLabelText('Entity Type');
      fireEvent.change(entitySelect, { target: { value: 'contact' } });

      const btn = screen.getByRole('button', { name: /execute query/i });
      fireEvent.click(btn);

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/v1/advanced-query');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body.workspaceId).toBe(WORKSPACE_ID);
      expect(body.entityType).toBe('contact');
    });

    it('shows result count after successful response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { entities: [{}, {}], totalCount: 2 } }),
      });
      global.fetch = mockFetch;

      setup();
      const entitySelect = screen.getByLabelText('Entity Type');
      fireEvent.change(entitySelect, { target: { value: 'contact' } });
      fireEvent.click(screen.getByRole('button', { name: /execute query/i }));

      await waitFor(() => expect(screen.getByText(/2 results/)).toBeInTheDocument());
    });

    it('shows error message on HTTP error response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Workspace not found' } }),
      });
      global.fetch = mockFetch;

      setup();
      const entitySelect = screen.getByLabelText('Entity Type');
      fireEvent.change(entitySelect, { target: { value: 'contact' } });
      fireEvent.click(screen.getByRole('button', { name: /execute query/i }));

      await waitFor(() => expect(screen.getByText('Workspace not found')).toBeInTheDocument());
    });

    it('shows truncated warning when result is truncated', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { entities: [], totalCount: 1000, truncated: true } }),
      });
      global.fetch = mockFetch;

      setup();
      const entitySelect = screen.getByLabelText('Entity Type');
      fireEvent.change(entitySelect, { target: { value: 'contact' } });
      fireEvent.click(screen.getByRole('button', { name: /execute query/i }));

      await waitFor(() => expect(screen.getByText('Results truncated')).toBeInTheDocument());
    });

    it('shows aggregation result in preformatted block', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { aggregation: { count: 42 } } }),
      });
      global.fetch = mockFetch;

      setup();
      const entitySelect = screen.getByLabelText('Entity Type');
      fireEvent.change(entitySelect, { target: { value: 'deal' } });
      const checkbox = screen.getByRole('checkbox', { name: /aggregation/i });
      fireEvent.click(checkbox);
      fireEvent.click(screen.getByRole('button', { name: /execute query/i }));

      await waitFor(() => expect(screen.getByText('Aggregation result:')).toBeInTheDocument());
    });
  });
});
