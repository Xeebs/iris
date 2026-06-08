'use client';

type FormatStat = {
  format: 'json' | 'csv' | 'parquet';
  count: number;
  pct: number;
};

type EndpointFormatRow = {
  endpoint: string;
  json: number;
  csv: number;
  parquet: number;
};

const FORMAT_COLORS = { json: 'bg-blue-500', csv: 'bg-green-500', parquet: 'bg-purple-500' };
const FORMAT_TEXT = { json: 'text-blue-400', csv: 'text-green-400', parquet: 'text-purple-400' };

export function ResponseFormatAnalytics({
  stats,
  byEndpoint,
}: {
  stats: FormatStat[];
  byEndpoint: EndpointFormatRow[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.format} className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
            <div className={`text-2xl font-bold ${FORMAT_TEXT[s.format]}`}>{s.pct.toFixed(1)}%</div>
            <div className="text-xs text-zinc-400 mt-1">{s.format.toUpperCase()} requests</div>
            <div className="text-xs text-zinc-600">{s.count.toLocaleString()} total</div>
          </div>
        ))}
      </div>

      {byEndpoint.length > 0 && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-700 text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Format usage by endpoint
          </div>
          {byEndpoint.map((row) => {
            const total = row.json + row.csv + row.parquet;
            const jsonPct = total > 0 ? (row.json / total) * 100 : 0;
            const csvPct = total > 0 ? (row.csv / total) * 100 : 0;
            const parquetPct = total > 0 ? (row.parquet / total) * 100 : 0;
            return (
              <div key={row.endpoint} className="px-4 py-3 border-b border-zinc-700/50 last:border-0">
                <div className="text-xs font-mono text-zinc-300 mb-1 truncate">{row.endpoint}</div>
                <div className="flex gap-0.5 h-2 rounded overflow-hidden">
                  <div className="bg-blue-500" style={{ width: `${jsonPct}%` }} title={`JSON: ${row.json}`} />
                  <div className="bg-green-500" style={{ width: `${csvPct}%` }} title={`CSV: ${row.csv}`} />
                  <div className="bg-purple-500" style={{ width: `${parquetPct}%` }} title={`Parquet: ${row.parquet}`} />
                </div>
                <div className="flex gap-3 mt-1 text-xs text-zinc-500">
                  <span>JSON: {row.json}</span>
                  <span>CSV: {row.csv}</span>
                  <span>Parquet: {row.parquet}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
