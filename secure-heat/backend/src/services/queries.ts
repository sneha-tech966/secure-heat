/** Pure helpers that turn validated query objects into Prisma arguments. Sort keys are whitelisted by the zod enums. */
type Dir = 'asc' | 'desc';
export const pageArgs = (q: { page: number; pageSize: number }) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
const range = (from?: Date, to?: Date) => (from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined);
const drop = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export function telemetryWhere(f: { sensorId?: string; q?: string; processingStatus?: string; decision?: string; from?: Date; to?: Date }) {
  return drop({ sensorId: f.sensorId ?? (f.q ? { contains: f.q, mode: 'insensitive' } : undefined), processingStatus: f.processingStatus, decision: f.decision, timestamp: range(f.from, f.to) });
}
export const telemetryOrder = (sortBy: string, order: Dir) => [{ [sortBy]: order }, { id: 'desc' as Dir }];

export function eventWhere(f: { sensorId?: string; severity?: string; status?: string; eventType?: string; from?: Date; to?: Date }) {
  return drop({ sensorId: f.sensorId, severity: f.severity, status: f.status, eventType: f.eventType, detectedAt: range(f.from, f.to) });
}
export const eventOrder = (sortBy: string, order: Dir) => [{ [sortBy]: order }, { id: 'desc' as Dir }];

/** pending = awaiting review; approved/rejected = reviewed outcomes. Only QUARANTINED rows are ever "pending". */
export function quarantineWhere(state: 'pending' | 'approved' | 'rejected', sensorId?: string) {
  const base = state === 'pending' ? { processingStatus: 'QUARANTINED' }
    : state === 'approved' ? { processingStatus: 'FORWARDED', reviewedById: { not: null }, decision: { not: 'ACCEPT' } }
    : { processingStatus: 'REJECTED', reviewedById: { not: null } };
  return drop({ ...base, sensorId });
}
