import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import type { Role } from '../types.js';
import { asyncHandler, HttpError } from '../utils/errors.js';

export const COOKIE_NAME = 'sh_token';

export const signToken = (config: AppConfig, user: { id: string; role: Role }): string =>
  jwt.sign({ role: user.role }, config.jwtSecret, { algorithm: 'HS256', subject: user.id, expiresIn: config.jwtExpiresSeconds });

export const cookieOptions = (config: AppConfig) => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'strict' as const, path: '/' });

/** Verifies the JWT cookie and loads the CURRENT user (so role changes/deletions take effect immediately). */
export function authenticate(db: PrismaClient, config: AppConfig): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (typeof token !== 'string') throw new HttpError(401, 'authentication required', 'UNAUTHENTICATED');
    let sub: string | undefined;
    try { sub = (jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload).sub; }
    catch { throw new HttpError(401, 'invalid or expired session', 'UNAUTHENTICATED'); }
    const user = sub ? await db.user.findUnique({ where: { id: sub }, select: { id: true, name: true, email: true, role: true } }) : null;
    if (!user) throw new HttpError(401, 'invalid or expired session', 'UNAUTHENTICATED');
    req.user = user; next();
  });
}

/** Server-side authorization. Frontend route guards are only UX; every protected route goes through this. */
export const requireRole = (...roles: readonly Role[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'authentication required', 'UNAUTHENTICATED'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'insufficient permissions', 'FORBIDDEN'));
  next();
};
