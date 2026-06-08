'use client';

type DlqEvent = {
  id: string;
  endpoint: string;
  eventType: string;
  finalError: string;
  failedAt: string;
  replayedAt: string | null;
};

export function DlqEventTable({ events, onReplay }: { events: DlqEvent[]; onReplay: (id: string) => void }) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-center text-zinc-500 text-sm">
        No events in dead-letter queue.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700">
      {events.map((ev) => (
        <div key={ev.id} className="px-4 py-3 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded font-mono">{ev.eventType}</span>
              {ev.replayedAt && (
                <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">replayed</span>
              )}
            </div>
            <div className="text-sm font-mono text-zinc-200 truncate">{ev.endpoint}</div>
            <div className="text-xs text-red-400 mt-0.5 truncate">{ev.finalError}</div>
            <div className="text-xs text-zinc-600 mt-1">{new Date(ev.failedAt).toLocaleString()}</div>
          </div>
          {!ev.replayedAt && (
            <button
              onClick={() => onReplay(ev.id)}
              className="px-3 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded flex-shrink-0"
            >
              Replay
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
