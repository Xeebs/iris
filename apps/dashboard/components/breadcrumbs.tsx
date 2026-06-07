'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SEGMENT_LABELS: Record<string, string> = {
  '': 'Dashboard',
  connectors: 'Connectors',
  setup: 'Setup',
  health: 'Health',
  analytics: 'Analytics',
  breakdown: 'Breakdown',
  queries: 'Queries',
  graph: 'Graph',
  workflows: 'Workflows',
  settings: 'Settings',
  workspace: 'Workspace',
  'nlp-setup': 'NLP Setup',
  'schema-review': 'Schema Review',
  docs: 'API Docs',
};

function segmentLabel(segment: string): string {
  if (segment in SEGMENT_LABELS) return SEGMENT_LABELS[segment] ?? segment;
  // Dynamic segments like [id], [workspaceId] → trim brackets, title-case
  if (segment.startsWith('[') && segment.endsWith(']')) {
    const name = segment.slice(1, -1);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs: { label: string; href: string }[] = [
    { label: 'Dashboard', href: '/' },
  ];

  let accumulated = '';
  for (const segment of segments) {
    accumulated += `/${segment}`;
    crumbs.push({ label: segmentLabel(segment), href: accumulated });
  }

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-500 mb-4">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-300" aria-hidden>/</span>}
          {i === crumbs.length - 1 ? (
            <span className="text-gray-700 font-medium">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-gray-700 hover:underline">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
