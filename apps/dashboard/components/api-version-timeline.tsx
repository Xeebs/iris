'use client';

type ApiVersionEntry = {
  version: string;
  status: 'active' | 'deprecated' | 'sunset';
  released_at: string;
  sunset_at: string | null;
  features: string[];
};

const STATUS_STYLES: Record<string, string> = {
  active: 'border-green-500/50 bg-green-500/10',
  deprecated: 'border-yellow-500/50 bg-yellow-500/10',
  sunset: 'border-red-500/50 bg-red-500/10',
};

const STATUS_DOT: Record<string, string> = {
  active: 'bg-green-400',
  deprecated: 'bg-yellow-400',
  sunset: 'bg-red-400',
};

export function ApiVersionTimeline({ versions }: { versions: ApiVersionEntry[] }) {
  if (versions.length === 0) {
    return <div className="text-zinc-500 text-sm">No API versions registered.</div>;
  }

  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-zinc-700" />
      <div className="space-y-4">
        {versions.map((v) => {
          const dot = STATUS_DOT[v.status] ?? 'bg-zinc-400';
          const card = STATUS_STYLES[v.status] ?? 'border-zinc-700 bg-zinc-800';
          return (
            <div key={v.version} className="pl-10 relative">
              <div className={`absolute left-3 top-3 w-3 h-3 rounded-full border-2 border-zinc-900 ${dot}`} />
              <div className={`rounded-lg border p-4 ${card}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white">{v.version}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">{v.status}</span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    Released {new Date(v.released_at).toLocaleDateString()}
                    {v.sunset_at && ` · Sunset ${new Date(v.sunset_at).toLocaleDateString()}`}
                  </div>
                </div>
                {v.features.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {v.features.map((f) => (
                      <span key={f} className="text-xs bg-zinc-700/70 text-zinc-300 px-2 py-0.5 rounded">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
