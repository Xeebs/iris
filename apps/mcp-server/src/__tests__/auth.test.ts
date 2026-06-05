import { describe, it, expect } from 'vitest';
import { assertWorkspace } from '../auth.js';

describe('assertWorkspace', () => {
  it('returns null when no authenticated workspace (dev mode)', () => {
    expect(assertWorkspace('any-workspace', null)).toBeNull();
  });

  it('returns null when requested workspace matches authenticated', () => {
    expect(assertWorkspace('ws-1', 'ws-1')).toBeNull();
  });

  it('returns an error message when workspaces do not match', () => {
    const msg = assertWorkspace('ws-other', 'ws-1');
    expect(msg).not.toBeNull();
    expect(msg).toContain('ws-other');
    expect(msg).toContain('denied');
  });

  it('returns null for any workspace when authenticatedWorkspaceId is null', () => {
    expect(assertWorkspace('ws-prod', null)).toBeNull();
    expect(assertWorkspace('ws-dev', null)).toBeNull();
    expect(assertWorkspace('', null)).toBeNull();
  });
});
