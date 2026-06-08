import type { Context, Next } from 'hono';
import { selectFormat, contentTypeFor, contentDispositionFor } from '@iris/semantic-core/response-serializer';
import type { ResponseFormat } from '@iris/semantic-core/response-serializer';

const AVAILABLE_FORMATS: ResponseFormat[] = ['json', 'csv', 'parquet'];

/**
 * Hono middleware that reads the Accept header (or ?format= param) and makes
 * the selected format available via `c.get('responseFormat')`.
 *
 * Individual route handlers are responsible for calling the serializer —
 * this middleware only negotiates and stores the preference.
 */
export async function contentNegotiationMiddleware(c: Context, next: Next) {
  const formatParam = c.req.query('format') as ResponseFormat | undefined;
  const acceptHeader = c.req.header('accept');

  const format: ResponseFormat = formatParam && AVAILABLE_FORMATS.includes(formatParam)
    ? formatParam
    : selectFormat(acceptHeader, AVAILABLE_FORMATS);

  c.set('responseFormat', format);

  await next();

  // If the route set a format-specific Content-Type (e.g., for streaming CSV),
  // honour it; otherwise we let the route handle it.
  if (!c.res.headers.get('content-type') || c.res.headers.get('content-type') === 'application/json') {
    c.header('Content-Type', contentTypeFor(format));
    const disposition = contentDispositionFor(format);
    if (disposition) c.header('Content-Disposition', disposition);
  }
}
