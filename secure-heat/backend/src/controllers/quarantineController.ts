import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { audit } from '../services/audit.js';
import type { Forwarder } from '../services/ports.js';
import { pageArgs, quarantineWhere } from '../services/queries.js';
import { reviewGuard } from '../services/workflow.js';
import type { RuleDetail } from '../types.js';
import { HttpError } from '../utils/errors.js';
import { quarantineQuery, reviewBody } from '../validators/query.js';

export function quarantineController(db: PrismaClient, forwarder: Forwarder) {
  async function review(req: Request, res: Response, action: 'approve' | 'reject') {
    const id = String(req.params.id); const { notes } = reviewBody.parse(req.body);
    const t = await db.telemetry.findUnique({ where: { id }, include: { sensor: { select: { status: true } } } });
    if (!t) throw new HttpError(404, 'telemetry record not found', 'NOT_FOUND');
    const g = reviewGuard({ processingStatus: t.processingStatus, rulesTriggered: (t.rulesTriggered as unknown as RuleDetail[]) ?? [] }, t.sensor.status, action);
    if (!g.ok) throw new HttpError(g.status, g.message, g.code);
    // atomic claim: only one reviewer can move a record out of QUARANTINED
    const data = { processingStatus: action === 'approve' ? ('FORWARDED' as const) : ('REJECTED' as const), reviewedById: req.user!.id, reviewedAt: new Date(), reviewNotes: notes };
    const claimed = await db.telemetry.updateMany({ where: { id, processingStatus: 'QUARANTINED' }, data });
    if (claimed.count === 0) throw new HttpError(409, 'record was already reviewed by someone else', 'CONFLICT');
    if (action === 'approve') {
      try { await forwarder.forward({ telemetryId: id, sensorId: t.sensorId, timestamp: t.timestamp.toISOString(),
        reading: { temperature: t.temperature, humidity: t.humidity, pressure: t.pressure, windSpeed: t.windSpeed, windDirection: t.windDirection, rainfall: t.rainfall, solarRadiation: t.solarRadiation } }); }
      catch {
        await db.telemetry.updateMany({ where: { id, processingStatus: 'FORWARDED', reviewedById: req.user!.id }, data: { processingStatus: 'QUARANTINED', reviewedById: null, reviewedAt: null, reviewNotes: null } });
        throw new HttpError(502, 'forecasting service unavailable; the record remains quarantined', 'FORWARD_FAILED');
      }
    }
    await audit(db, req, { action: action === 'approve' ? 'QUARANTINE_APPROVED' : 'QUARANTINE_REJECTED', targetType: 'Telemetry', targetId: id,
      details: { sensorId: t.sensorId, decision: t.decision, anomalyScore: t.anomalyScore, notes } });
    res.json({ id, processingStatus: data.processingStatus });
  }

  return {
    async list(req: Request, res: Response) {
      const q = quarantineQuery.parse(req.query); const where = quarantineWhere(q.state, q.sensorId) as Prisma.TelemetryWhereInput;
      const [items, total] = await Promise.all([
        db.telemetry.findMany({ where, orderBy: { timestamp: 'desc' }, ...pageArgs(q), include: { reviewedBy: { select: { name: true } },
          events: { select: { id: true, eventType: true, severity: true, description: true }, take: 3 } } }),
        db.telemetry.count({ where }),
      ]);
      const reason = (r: RuleDetail[], decision: string) => r.some((x) => x.hard) ? 'Physically impossible value' : r.length ? 'Rule triggered' : decision === 'FLAG' ? 'Moderate anomaly held for review' : 'Strong anomaly evidence';
      res.json({ items: items.map(({ rulesTriggered, ...t }) => ({ ...t, rulesTriggered, quarantineReason: reason((rulesTriggered as unknown as RuleDetail[]) ?? [], t.decision) })), total, page: q.page, pageSize: q.pageSize });
    },
    approve: (req: Request, res: Response) => review(req, res, 'approve'),
    reject: (req: Request, res: Response) => review(req, res, 'reject'),
  };
}
