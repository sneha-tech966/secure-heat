import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { baselineForecast } from '../services/forecast.js';
import { pageArgs, telemetryOrder, telemetryWhere } from '../services/queries.js';
import { HttpError } from '../utils/errors.js';
import { telemetryQuery, trendsQuery, trustedQuery } from '../validators/query.js';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function dataController(db: PrismaClient) {
  return {
    async list(req: Request, res: Response) {
      const q = telemetryQuery.parse(req.query); const where = telemetryWhere(q) as Prisma.TelemetryWhereInput;
      const [items, total] = await Promise.all([
        db.telemetry.findMany({ where, orderBy: telemetryOrder(q.sortBy, q.order) as Prisma.TelemetryOrderByWithRelationInput[], ...pageArgs(q),
          select: { id: true, sensorId: true, sequenceNumber: true, timestamp: true, temperature: true, humidity: true, pressure: true, windSpeed: true, windDirection: true,
            rainfall: true, solarRadiation: true, anomalyScore: true, anomalyStatus: true, decision: true, processingStatus: true } }),
        db.telemetry.count({ where }),
      ]);
      res.json({ items, total, page: q.page, pageSize: q.pageSize });
    },

    async detail(req: Request, res: Response) {
      const t = await db.telemetry.findUnique({ where: { id: String(req.params.id) }, include: {
        sensor: { select: { sensorId: true, name: true, location: true, status: true } }, reviewedBy: { select: { name: true, email: true } },
        events: { select: { id: true, eventType: true, severity: true, status: true, description: true, detectedAt: true }, orderBy: { detectedAt: 'asc' } } } });
      if (!t) throw new HttpError(404, 'telemetry record not found', 'NOT_FOUND');
      const { sensor, reviewedBy, events, rulesTriggered, explanation, ...rest } = t;
      res.json({ telemetry: { ...rest, sensor, events },
        pipeline: { authentication: { apiKeyVerified: true, signatureValid: t.signatureValid }, rules: rulesTriggered,
          ml: { anomalyScore: t.anomalyScore, anomalyStatus: t.anomalyStatus, explanation }, decision: t.decision, processingStatus: t.processingStatus,
          review: t.reviewedAt ? { by: reviewedBy, at: t.reviewedAt, notes: t.reviewNotes } : null } });
    },

    /** INTEGRATION BOUNDARY for forecasting: only FORWARDED rows (accepted, or released by a human reviewer). Raw / quarantined /
     *  rejected rows can never appear here, and scores / explanations are deliberately not exposed to consumers. */
    async trusted(req: Request, res: Response) {
      const q = trustedQuery.parse(req.query);
      const where = { ...(telemetryWhere({ sensorId: q.sensorId, from: q.from, to: q.to }) as Prisma.TelemetryWhereInput), processingStatus: 'FORWARDED' as const };
      const rows = await db.telemetry.findMany({ where, orderBy: { timestamp: 'desc' }, take: q.limit,
        select: { id: true, sensorId: true, timestamp: true, temperature: true, humidity: true, pressure: true, windSpeed: true, windDirection: true, rainfall: true, solarRadiation: true, reviewedById: true } });
      res.json({ items: rows.map(({ reviewedById, ...r }) => ({ ...r, approvedByReview: reviewedById !== null })), count: rows.length });
    },

    /** Hourly trusted means + baseline forecast, plus what a naive pipeline WITHOUT Secure-Heat would have averaged (all stored readings). */
    async trends(req: Request, res: Response) {
      const q = trendsQuery.parse(req.query); const since = new Date(Date.now() - q.hours * 3_600_000);
      const sensorCond = q.sensorId ? Prisma.sql`AND "sensorId" = ${q.sensorId}` : Prisma.empty;
      type Row = { bucket: Date; temperature: number; humidity: number; pressure: number; n: bigint };
      const [trusted, naive, excluded] = await Promise.all([
        db.$queryRaw<Row[]>(Prisma.sql`SELECT date_trunc('hour', "timestamp") AS bucket, AVG("temperature") AS temperature, AVG("humidity") AS humidity, AVG("pressure") AS pressure, COUNT(*) AS n
          FROM "Telemetry" WHERE "timestamp" >= ${since} AND "processingStatus" = 'FORWARDED' ${sensorCond} GROUP BY 1 ORDER BY 1`),
        db.$queryRaw<Row[]>(Prisma.sql`SELECT date_trunc('hour', "timestamp") AS bucket, AVG("temperature") AS temperature, AVG("humidity") AS humidity, AVG("pressure") AS pressure, COUNT(*) AS n
          FROM "Telemetry" WHERE "timestamp" >= ${since} ${sensorCond} GROUP BY 1 ORDER BY 1`),
        db.telemetry.groupBy({ by: ['processingStatus'], where: { timestamp: { gte: since }, processingStatus: { in: ['QUARANTINED', 'REJECTED'] }, ...(q.sensorId ? { sensorId: q.sensorId } : {}) }, _count: { _all: true } }),
      ]);
      const series = (rows: Row[]) => rows.map((r) => ({ t: r.bucket, temperature: num(r.temperature), humidity: num(r.humidity), pressure: num(r.pressure), n: Number(r.n) }));
      const T = series(trusted);
      const fc = (k: 'temperature' | 'humidity' | 'pressure') => baselineForecast(T.map((r) => r[k] as number), q.horizon);
      res.json({ hours: q.hours, trusted: T, naiveAllReadings: series(naive).map(({ t, temperature }) => ({ t, temperature })),
        excluded: Object.fromEntries(excluded.map((e) => [e.processingStatus, e._count._all])),
        forecast: { temperature: fc('temperature'), humidity: fc('humidity'), pressure: fc('pressure') },
        note: 'Forecast is a simple damped-trend baseline on TRUSTED data only; it demonstrates the integrity boundary and is not a production weather model.' });
    },
  };
}
