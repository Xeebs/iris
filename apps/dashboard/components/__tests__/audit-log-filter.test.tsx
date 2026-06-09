import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { AuditLogFilter } from '../audit-log-filter.js';
import type { AuditLogFilterValues } from '../audit-log-filter.js';

const EMPTY: AuditLogFilterValues = {};

describe('AuditLogFilter', () => {
  it('renders all filter fields', () => {
    render(<AuditLogFilter values={EMPTY} onChange={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/user-id/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/contact/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });

  it('displays current action value in select', () => {
    render(<AuditLogFilter values={{ action: 'login' }} onChange={vi.fn()} onReset={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('login');
  });

  it('calls onChange with new action when select changes', () => {
    const onChange = vi.fn();
    render(<AuditLogFilter values={EMPTY} onChange={onChange} onReset={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'entity_write' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'entity_write' }));
  });

  it('calls onChange with undefined action when empty option selected', () => {
    const onChange = vi.fn();
    render(<AuditLogFilter values={{ action: 'login' }} onChange={onChange} onReset={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ action: undefined }));
  });

  it('calls onChange with actorId when text input changes', () => {
    const onChange = vi.fn();
    render(<AuditLogFilter values={EMPTY} onChange={onChange} onReset={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/user-id/i), { target: { value: 'user-123' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'user-123' }));
  });

  it('calls onChange with undefined actorId when input cleared', () => {
    const onChange = vi.fn();
    render(<AuditLogFilter values={{ actorId: 'user-abc' }} onChange={onChange} onReset={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/user-id/i), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ actorId: undefined }));
  });

  it('calls onReset when Reset button is clicked', () => {
    const onReset = vi.fn();
    render(<AuditLogFilter values={EMPTY} onChange={vi.fn()} onReset={onReset} />);
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('merges existing filter values on partial change', () => {
    const onChange = vi.fn();
    const initial: AuditLogFilterValues = { action: 'login', actorId: 'user-1' };
    render(<AuditLogFilter values={initial} onChange={onChange} onReset={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/contact/i), { target: { value: 'deal' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'login', actorId: 'user-1', resourceType: 'deal' }));
  });
});
