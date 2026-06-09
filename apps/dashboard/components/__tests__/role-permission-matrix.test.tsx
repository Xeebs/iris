import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { RolePermissionMatrix } from '../role-permission-matrix.js';

const PERM = (action: string, resource: string) => ({
  permissionName: `${action}:${resource}`,
  grantedAt: '2026-01-01T00:00:00Z',
  grantedBy: 'admin-user',
});

describe('RolePermissionMatrix', () => {
  it('renders all resource rows', () => {
    render(<RolePermissionMatrix roleId="role-1" permissions={[]} onRevoke={vi.fn()} />);
    expect(screen.getByText('entities')).toBeInTheDocument();
    expect(screen.getByText('connectors')).toBeInTheDocument();
    expect(screen.getByText('users')).toBeInTheDocument();
  });

  it('renders all action column headers', () => {
    render(<RolePermissionMatrix roleId="role-1" permissions={[]} onRevoke={vi.fn()} />);
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('delete')).toBeInTheDocument();
  });

  it('renders a granted permission button', () => {
    const permissions = [PERM('read', 'entities')];
    render(<RolePermissionMatrix roleId="role-1" permissions={permissions} onRevoke={vi.fn()} />);
    const btn = screen.getByTitle('Granted by admin-user');
    expect(btn).toBeInTheDocument();
  });

  it('calls onRevoke with the correct permissionName when clicked', () => {
    const onRevoke = vi.fn();
    const permissions = [PERM('read', 'entities')];
    render(<RolePermissionMatrix roleId="role-1" permissions={permissions} onRevoke={onRevoke} />);
    fireEvent.click(screen.getByTitle('Granted by admin-user'));
    expect(onRevoke).toHaveBeenCalledWith('read:entities');
  });

  it('does not call onRevoke for empty cells', () => {
    const onRevoke = vi.fn();
    render(<RolePermissionMatrix roleId="role-1" permissions={[]} onRevoke={onRevoke} />);
    expect(onRevoke).not.toHaveBeenCalled();
  });

  it('renders multiple granted permissions independently', () => {
    const permissions = [PERM('read', 'entities'), PERM('write', 'connectors'), PERM('admin', 'workspaces')];
    render(<RolePermissionMatrix roleId="role-1" permissions={permissions} onRevoke={vi.fn()} />);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(3);
  });

  it('shows a hint footer text', () => {
    render(<RolePermissionMatrix roleId="role-1" permissions={[]} onRevoke={vi.fn()} />);
    expect(screen.getByText(/revoke/i)).toBeInTheDocument();
  });

  it('renders without errors when permissions array is empty', () => {
    const { container } = render(<RolePermissionMatrix roleId="role-1" permissions={[]} onRevoke={vi.fn()} />);
    expect(container.querySelector('table')).toBeInTheDocument();
  });
});
