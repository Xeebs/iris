// ─── Types ────────────────────────────────────────────────────────────────────

export type ResponseFormat = 'json' | 'csv' | 'parquet';

export type AcceptEntry = {
  format: ResponseFormat;
  quality: number;
};

export type EntityRecord = Record<string, string | number | boolean | null | undefined>;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parse an Accept header into ranked format preferences.
 * Example: "text/csv;q=0.8, application/json" → [{format:'json',q:1}, {format:'csv',q:0.8}]
 */
export function parseAcceptHeader(header: string | null | undefined): AcceptEntry[] {
  if (!header) return [{ format: 'json', quality: 1 }];

  const MIME_MAP: Record<string, ResponseFormat> = {
    'application/json': 'json',
    'text/json': 'json',
    'text/csv': 'csv',
    'application/csv': 'csv',
    'application/vnd.apache.parquet': 'parquet',
    'application/parquet': 'parquet',
    '*/*': 'json',
  };

  const entries: AcceptEntry[] = [];
  for (const part of header.split(',')) {
    const [mime, ...params] = part.trim().split(';');
    const qParam = params.find((p) => p.trim().startsWith('q='));
    const quality = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
    const format = MIME_MAP[mime?.trim() ?? ''];
    if (format) entries.push({ format, quality });
  }

  return entries.sort((a, b) => b.quality - a.quality);
}

/**
 * Select the best format from the Accept header preferences.
 * Falls back to JSON if nothing matches.
 */
export function selectFormat(
  acceptHeader: string | null | undefined,
  available: ResponseFormat[] = ['json', 'csv'],
): ResponseFormat {
  const preferences = parseAcceptHeader(acceptHeader);
  for (const pref of preferences) {
    if (available.includes(pref.format)) return pref.format;
  }
  return 'json';
}

/**
 * Escape a CSV field value (quotes and commas).
 */
export function csvEscapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize an array of records to CSV with header row.
 * Columns are derived from the union of all keys, sorted for stability.
 */
export function serializeAsCsv(records: EntityRecord[]): string {
  if (records.length === 0) return '';
  const columns = [...new Set(records.flatMap(Object.keys))].sort();
  const header = columns.map(csvEscapeField).join(',');
  const rows = records.map((r) => columns.map((col) => csvEscapeField(r[col])).join(','));
  return [header, ...rows].join('\n');
}

/**
 * Serialize records to standard JSON envelope.
 */
export function serializeAsJson(records: EntityRecord[], meta?: Record<string, unknown>): string {
  return JSON.stringify({ data: records, ...(meta ? { meta } : {}) });
}

/**
 * Return a stub Parquet buffer (binary format requires native libs — this stub
 * returns a well-formed error payload so callers know to request JSON/CSV instead).
 * In production, integrate with `parquetjs` or arrow/native binding.
 */
export function serializeAsParquet(records: EntityRecord[]): Buffer {
  // Parquet requires a C++ or WASM native binding not available in this environment.
  // Return a placeholder that clients can detect.
  const placeholder = JSON.stringify({ _parquet_stub: true, rowCount: records.length });
  return Buffer.from(placeholder, 'utf8');
}

/**
 * Get the Content-Type header value for a given format.
 */
export function contentTypeFor(format: ResponseFormat): string {
  const map: Record<ResponseFormat, string> = {
    json: 'application/json; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    parquet: 'application/vnd.apache.parquet',
  };
  return map[format];
}

/**
 * Get the Content-Disposition header for file download (csv/parquet).
 */
export function contentDispositionFor(format: ResponseFormat, filename = 'export'): string | null {
  if (format === 'json') return null;
  const ext = format === 'parquet' ? 'parquet' : 'csv';
  return `attachment; filename="${filename}.${ext}"`;
}

// ─── ResponseSerializer ───────────────────────────────────────────────────────

export class ResponseSerializer {
  /**
   * Serialize records to the requested format. Returns {body, contentType, contentDisposition}.
   */
  serialize(
    records: EntityRecord[],
    format: ResponseFormat,
    filename = 'export',
    meta?: Record<string, unknown>,
  ): { body: string | Buffer; contentType: string; contentDisposition: string | null } {
    const contentType = contentTypeFor(format);
    const contentDisposition = contentDispositionFor(format, filename);

    switch (format) {
      case 'csv':
        return { body: serializeAsCsv(records), contentType, contentDisposition };
      case 'parquet':
        return { body: serializeAsParquet(records), contentType, contentDisposition };
      default:
        return { body: serializeAsJson(records, meta), contentType, contentDisposition };
    }
  }
}
