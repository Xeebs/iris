'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Breadcrumbs } from './breadcrumbs.js';

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: '⬡' },
  { href: '/connectors', label: 'Connectors', icon: '⟳' },
  { href: '/queries', label: 'Queries', icon: '⌕' },
  { href: '/analytics', label: 'Analytics', icon: '▤' },
  { href: '/graph', label: 'Knowledge Graph', icon: '◎' },
  { href: '/workflows', label: 'Workflows', icon: '⧓' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
] as const;

function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

type Props = {
  children: React.ReactNode;
  workspaceId?: string;
  workspaceName?: string;
};

export function DashboardLayout({ children, workspaceId, workspaceName }: Props) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-56 bg-white border-r border-gray-200 flex flex-col transition-transform lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-gray-100">
          <Link href="/" className="font-bold text-gray-900 text-lg tracking-tight">
            Iris
          </Link>
          <span className="ml-1.5 text-xs text-gray-400 font-normal">context</span>
        </div>

        {/* Workspace selector */}
        {workspaceId && (
          <div className="px-3 py-2 border-b border-gray-100">
            <Link
              href={`/settings/${workspaceId}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 group"
            >
              <span className="w-6 h-6 rounded bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600">
                {(workspaceName ?? workspaceId)[0]?.toUpperCase() ?? 'W'}
              </span>
              <span className="text-sm text-gray-700 font-medium truncate flex-1">
                {workspaceName ?? workspaceId}
              </span>
              <span className="text-gray-400 text-xs group-hover:text-gray-600">⚙</span>
            </Link>
          </div>
        )}

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors ${
                isActive(href, pathname)
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span aria-hidden className="text-base w-4 text-center">{icon}</span>
              {label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
          Iris v0.1
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="text-gray-500 hover:text-gray-700"
          >
            ☰
          </button>
          <span className="font-bold text-gray-900">Iris</span>
        </header>

        <main className="flex-1 p-6">
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}
