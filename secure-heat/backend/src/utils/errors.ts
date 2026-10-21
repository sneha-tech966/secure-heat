import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = 'ERROR') { super(message); }
}
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

/** True for a Prisma unique-constraint violation (P2002). Duck-typed so it does not depend on class identity across package copies. */
export const isUniqueViolation = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
