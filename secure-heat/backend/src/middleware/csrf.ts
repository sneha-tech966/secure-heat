import type { RequestHandler } from 'express';
import type { AppConfig } from '../config/env.js';
import { HttpError } from '../utils/errors.js';

/** Defence in depth for cookie auth (on top of SameSite=Strict): state-changing requests must carry a custom header
 *  (which cross-site forms cannot set) and, if an Origin header is present, it must be an allowed origin. */
export const csrfGuard = (config: AppConfig): RequestHandler => (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'SecureHeat') return next(new HttpError(403, 'missing CSRF header', 'CSRF'));
  const origin = req.get('origin');
  if (origin && !config.corsOrigin.includes(origin)) return next(new HttpError(403, 'origin not allowed', 'CSRF'));
  next();
};
