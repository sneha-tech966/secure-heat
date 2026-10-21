import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { audit } from '../services/audit.js';
import { eventOrder, eventWhere, pageArgs } from '../services/queries.js';
import { nextEventStatus } from '../services/workflow.js';
import type { EventStatus } from '../types.js';
import { HttpError } from '../utils/errors.js';
import { eventNoteBody, eventQuery, resolveBody } from '../validators/query.js';

export function eventController(db: PrismaClient) {
  const load = async (req: Request) => {
    const e = await db.securityEvent.findUnique({ where: { id: String(req.params.id) } });
    if (!e) throw new HttpError(404, 'event not found', 'NOT_FOUND'); return e;
  };
  return {
    async list(req: Request, res: Response) {
      const q = eventQuery.parse(req.query); const where = eventWhere(q) as Prisma.SecurityEventWhereInput;
      const [items, total] = await Promise.all([
        db.securityEvent.findMany({ where, orderBy: eventOrder(q.sortBy, q.order) as Prisma.SecurityEventOrderByWithRelationInput[], ...pageArgs(q),
          include: { sensor: { select: { name: true } }, investigatedBy: { select: { name: true } } } }),
        db.securityEvent.count({ where }),
      ]);
      res.json({ items, total, page: q.page, pageSize: q.pageSize });
    },

    async detail(req: Request, res: Response) {
      const e = await db.securityEvent.findUnique({ where: { id: String(req.params.id) }, include: {
        sensor: { select: { sensorId: true, name: true, location: true, status: true } }, investigatedBy: { select: { name: true, email: true } },
        telemetry: { select: { id: true, timestamp: true, temperature: true, humidity: true, pressure: true, windSpeed: true, anomalyScore: true, decision: true, processingStatus: true, explanation: true } } } });
      if (!e) throw new HttpError(404, 'event not found', 'NOT_FOUND');
      const trail = await db.auditLog.findMany({ where: { targetType: 'SecurityEvent', targetId: e.id }, orderBy: { createdAt: 'asc' }, select: { id: true, actorLabel: true, action: true, details: true, createdAt: true } });
      res.json({ event: e, auditTrail: trail });
    },

    async investigate(req: Request, res: Response) {
      const e = await load(req); const next = nextEventStatus(e.status as EventStatus, 'investigate');
      if (!next) throw new HttpError(409, `event is already ${e.status.toLowerCase()}`, 'INVALID_TRANSITION');
      // guarded update: if two analysts click at once, only one transition wins
      const r = await db.securityEvent.updateMany({ where: { id: e.id, status: e.status }, data: { status: next, investigatedById: req.user!.id } });
      if (r.count === 0) throw new HttpError(409, 'event was changed by someone else; reload', 'CONFLICT');
      await audit(db, req, { action: 'EVENT_INVESTIGATING', targetType: 'SecurityEvent', targetId: e.id, details: { from: e.status, to: next } });
      res.json({ event: await db.securityEvent.findUnique({ where: { id: e.id } }) });
    },

    async addNote(req: Request, res: Response) {
      const e = await load(req); const b = eventNoteBody.parse(req.body);
      await audit(db, req, { action: 'EVENT_NOTE', targetType: 'SecurityEvent', targetId: e.id, details: { note: b.note } });
      res.status(201).json({ ok: true });
    },

    async resolve(req: Request, res: Response) {
      const e = await load(req); const b = resolveBody.parse(req.body); const next = nextEventStatus(e.status as EventStatus, 'resolve');
      if (!next) throw new HttpError(409, 'event is already resolved', 'INVALID_TRANSITION');
      const r = await db.securityEvent.updateMany({ where: { id: e.id, status: e.status },
        data: { status: next, resolutionNotes: b.resolutionNotes, resolvedAt: new Date(), investigatedById: e.investigatedById ?? req.user!.id } });
      if (r.count === 0) throw new HttpError(409, 'event was changed by someone else; reload', 'CONFLICT');
      await audit(db, req, { action: 'EVENT_RESOLVED', targetType: 'SecurityEvent', targetId: e.id, details: { from: e.status, notes: b.resolutionNotes } });
      res.json({ event: await db.securityEvent.findUnique({ where: { id: e.id } }) });
    },
  };
}
