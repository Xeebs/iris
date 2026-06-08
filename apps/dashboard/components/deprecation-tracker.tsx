'use client';

type DeprecatedEndpoint = {
  path: string;
  method: string;
  version: string;
  status: 'deprecated' | 'sunset';
  sunset_at: string | null;
  migrationPath: string | null;
};

export function DeprecationTracker({ endpoints }: { endpoints: DeprecatedEndpoint[] }) {
  if (endpoints.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-center text-zinc-500 text-sm">
        No deprecated endpoints — all endpoints are current.
      </div>
    );
  }

  const sunsetted = endpoints.filter((e) => e.status === 'sunset');
  const deprecated = endpoints.filter((e) => e.status === 'deprecated');

  return (
    <div className="space-y-3">
      {sunsetted.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-xs text-red-400">
          {sunsetted.length} endpoint(s) have been sunset — clients using these must be updated immediately.
        </div>
      )}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700">
        {endpoints.map((ep) => (
          <div key={`${ep.method}:${ep.path}:${ep.version}`} className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded font-mono">{ep.method}</span>
                <span className="text-sm font-mono text-zinc-200 truncate">{ep.path}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${ep.status === 'sunset' ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                  {ep.status}
                </span>
              </div>
              {ep.migrationPath && (
                <div className="text-xs text-zinc-500">
                  Migrate to: <span className="font-mono text-zinc-400">{ep.migrationPath}</span>
                </div>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs text-zinc-400">{ep.version}</div>
              {ep.sunset_at && (
                <div className="text-xs text-zinc-500">Sunset {new Date(ep.sunset_at).toLocaleDateString()}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
