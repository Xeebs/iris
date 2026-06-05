import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'api' });

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      { error: { code: 'HTTP_ERROR', message: err.message } },
      err.status,
    );
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.errors,
        },
      },
      400,
    );
  }

  log.error('Unhandled API error', { error: err, path: c.req.path });
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, 500);
};
