'use client';

import { useEffect, useState } from 'react';
import { ApiVersionTimeline } from '../../../components/api-version-timeline.js';
import { DeprecationTracker } from '../../../components/deprecation-tracker.js';

type ApiVersionEntry = {
  version: string;
  status: 'active' | 'deprecated' | 'sunset';
  released_at: string;
  sunset_at: string | null;
  features: string[];
};

type DeprecatedEndpoint = {
  path: string;
  method: string;
  version: string;
  status: 'deprecated' | 'sunset';
  sunset_at: string | null;
  migrationPath: string | null;
};

export default function ApiVersioningPage() {
  const [versions, setVersions] = useState<ApiVersionEntry[]>([]);
  const [deprecated, setDeprecated] = useState<DeprecatedEndpoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const vRes = await fetch('/api/v1/admin/api-versions');
      if (vRes.ok) {
        const json = await vRes.json();
        setVersions(json.data ?? []);

        // Load deprecated endpoints for each version
        const allDeprecated: DeprecatedEndpoint[] = [];
        for (const v of json.data ?? []) {
          const dRes = await fetch(`/api/v1/admin/api-versions/${v.version}/deprecated`);
          if (dRes.ok) {
            const dJson = await dRes.json();
            allDeprecated.push(...(dJson.data ?? []));
          }
        }
        setDeprecated(allDeprecated);
      }
      setLoading(false);
    }
    load();
  }, []);

  const activeCount = versions.filter((v) => v.status === 'active').length;
  const deprecatedCount = versions.filter((v) => v.status === 'deprecated').length;
  const sunsetCount = versions.filter((v) => v.status === 'sunset').length;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">API Versioning</h1>
        <p className="text-sm text-zinc-400 mt-1">Lifecycle management for API versions and deprecated endpoints.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{loading ? '—' : activeCount}</div>
          <div className="text-xs text-zinc-400 mt-1">Active</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">{loading ? '—' : deprecatedCount}</div>
          <div className="text-xs text-zinc-400 mt-1">Deprecated</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 text-center">
          <div className="text-2xl font-bold text-red-400">{loading ? '—' : sunsetCount}</div>
          <div className="text-xs text-zinc-400 mt-1">Sunset</div>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Version Timeline</h2>
        {loading ? (
          <div className="text-zinc-500 text-sm">Loading…</div>
        ) : (
          <ApiVersionTimeline versions={versions} />
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
          Deprecated Endpoints
          {deprecated.length > 0 && <span className="ml-2 text-yellow-400">({deprecated.length})</span>}
        </h2>
        {loading ? (
          <div className="text-zinc-500 text-sm">Loading…</div>
        ) : (
          <DeprecationTracker endpoints={deprecated} />
        )}
      </section>
    </div>
  );
}
