'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface Workspace {
  id: string;
  name: string;
}

interface WorkspaceSelectorProps {
  workspaces: Workspace[];
  currentWorkspaceId: string;
  /** Called when the user commits a workspace switch — use to set a cookie or call an API. */
  onSwitch?: (workspaceId: string) => Promise<void>;
}

/**
 * Dropdown selector for switching between workspaces.
 * Renders a native <select> for simplicity; replace with shadcn/ui Select if preferred.
 *
 * @param workspaces          - List of workspaces the user has access to
 * @param currentWorkspaceId  - Currently active workspace
 * @param onSwitch            - Async callback invoked on selection change
 */
export function WorkspaceSelector({
  workspaces,
  currentWorkspaceId,
  onSwitch,
}: WorkspaceSelectorProps): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentWorkspaceId);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = e.target.value;
    setSelected(nextId);
    setError(null);

    try {
      await onSwitch?.(nextId);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError('Failed to switch workspace. Please try again.');
      setSelected(currentWorkspaceId);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="workspace-select" className="sr-only">
        Workspace
      </label>
      <select
        id="workspace-select"
        value={selected}
        onChange={handleChange}
        disabled={isPending}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        aria-label="Select workspace"
      >
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name}
          </option>
        ))}
      </select>
      {error !== null && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
