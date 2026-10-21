import rateLimit from 'express-rate-limit';
import type { AppConfig } from '../config/env.js';

const make = (windowMs: number, limit: number, message: string, skipSuccessfulRequests = false) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests, message: { error: 'RATE_LIMITED', message } });

export const globalLimiter = (c: AppConfig) => make(c.rateLimitWindowMs, c.rateLimitMax, 'too many requests');
/** Brute-force protection: failed logins only count (successful ones are skipped). */
export const loginLimiter = (c: AppConfig) => make(15 * 60_000, c.authRateLimitMax, 'too many login attempts, try again later', true);
export const ingestLimiter = (c: AppConfig) => make(c.rateLimitWindowMs, c.ingestRateLimitMax, 'telemetry rate limit exceeded');
