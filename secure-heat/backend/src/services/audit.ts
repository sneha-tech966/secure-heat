import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';

export interface AuditEntry { action: string; targetType: string; targetId?: string | null; details?: Prisma.InputJsonValue }

/** Writes an audit record for a security-relevant operation. `req.user` may be absent (e.g. failed login). */
export async function audit(db: PrismaClient, req: Request, e: AuditEntry, actorLabelOverride?: string): Promise<void> {
  try {
    await db.auditLog.create({ data: { actorId: req.user?.id ?? null, actorLabel: actorLabelOverride ?? req.user?.email ?? 'anonymous',
      action: e.action, targetType: e.targetType, targetId: e.targetId ?? null, details: e.details ?? undefined, ip: req.ip?.slice(0, 64) ?? null } });
  } catch (err) { console.error('audit write failed:', err instanceof Error ? err.message : err); }
}
