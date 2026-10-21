import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/errors.js';

export const notFound: RequestHandler = (_req, res) => { res.status(404).json({ error: 'not_found', message: 'route not found' }); };

/** Never leaks stack traces or internals; unknown errors become a generic 500 (details go to the server log only). */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.code, message: err.message });
  if (err instanceof ZodError) return void res.status(400).json({ error: 'VALIDATION', message: 'invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  const t = (err as { type?: string }).type;
  if (t === 'entity.parse.failed') return void res.status(400).json({ error: 'INVALID_JSON', message: 'request body is not valid JSON' });
  if (t === 'entity.too.large') return void res.status(413).json({ error: 'TOO_LARGE', message: 'request body too large' });
  console.error('unhandled error:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown');
  res.status(500).json({ error: 'INTERNAL', message: 'internal server error' });
};
