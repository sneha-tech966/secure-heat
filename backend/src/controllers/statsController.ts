import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { audit } from '../services/audit.js';
import { histogram, MODEL_LIMITATIONS } from '../services/analytics.js';
import { HttpError } from '../utils/errors.js';
import { overviewQuery } from '../validators/query.js';

const BLOCKED_TYPES = ['AUTHENTICATION_FAILURE', 'INVALID_SIGNATURE', 'REPLAY_ATTACK', 'BLOCKED_SENSOR', 'INVALID_TELEMETRY'] as const;
const counts = <K extends string>(rows: { _count: { _all: number } }[], key: (r: any) => K) => Object.fromEntries(rows.map((r) => [key(r), r._count._all])) as Record<K, number>;

async function scoreDistribution(db: PrismaClient, since: Date) {
  const rows = await db.telemetry.findMany({ where: { timestamp: { gte: since }, anomalyScore: { not: null } }, select: { anomalyScore: true, decision: true }, take: 50_000 });
  return { normal: histogram(rows.filter((r) => r.decision === 'ACCEPT').map((r) => r.anomalyScore as number)), anomalous: histogram(rows.filter((r) => r.decision !== 'ACCEPT').map((r) => r.anomalyScore as number)), sampled: rows.length };
}

export function statsController(db: PrismaClient, config: AppConfig) {
  const mlHeaders = { ...(config.mlInternalToken ? { 'x-internal-token': config.mlInternalToken } : {}) };
  const ml = async (path: string, method: 'GET' | 'POST', timeoutMs = 10_000) => {
    try { const r = await fetch(config.mlServiceUrl + path, { method, headers: mlHeaders, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new HttpError(502, `ML service responded ${r.status}`, 'ML_ERROR'); return await r.json() as any; }
    catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, 'ML service unreachable', 'ML_UNREACHABLE'); }
  };

  return {
    async overview(req: Request, res: Response) {
      const { hours } = overviewQuery.parse(req.query); const since = new Date(Date.now() - hours * 3_600_000);
      type Vol = { bucket: Date; total: bigint; anomalous: bigint };
      const [sensorsTotal, sensorsActive, telemetryTotal, trusted, anomalies, blocked, volume, severity, perSensorAll, perSensorBad, scores, recent, sensors] = await Promise.all([
        db.sensor.count(), db.sensor.count({ where: { status: 'ACTIVE' } }), db.telemetry.count(), db.telemetry.count({ where: { processingStatus: 'FORWARDED' } }),
        db.telemetry.count({ where: { decision: { not: 'ACCEPT' } } }), db.securityEvent.count({ where: { eventType: { in: [...BLOCKED_TYPES] } } }),
        db.$queryRaw<Vol[]>(Prisma.sql`SELECT date_trunc('hour', "timestamp") AS bucket, COUNT(*) AS total, COUNT(*) FILTER (WHERE "decision" <> 'ACCEPT') AS anomalous
          FROM "Telemetry" WHERE "timestamp" >= ${since} GROUP BY 1 ORDER BY 1`),
        db.securityEvent.groupBy({ by: ['severity'], where: { detectedAt: { gte: since } }, _count: { _all: true } }),
        db.telemetry.groupBy({ by: ['sensorId'], where: { timestamp: { gte: since } }, _count: { _all: true } }),
        db.telemetry.groupBy({ by: ['sensorId'], where: { timestamp: { gte: since }, decision: { not: 'ACCEPT' } }, _count: { _all: true } }),
        scoreDistribution(db, since),
        db.securityEvent.findMany({ orderBy: { detectedAt: 'desc' }, take: 10, select: { id: true, eventType: true, severity: true, status: true, sensorId: true, claimedSensorId: true, detectedAt: true, description: true } }),
        db.sensor.findMany({ orderBy: { sensorId: 'asc' }, select: { sensorId: true, name: true, location: true, status: true, lastSeen: true } }),
      ]);
      const allSensorAnomalies = await db.telemetry.groupBy({ by: ['sensorId'], where: { decision: { not: 'ACCEPT' } }, _count: { _all: true } });
      const bad = counts(perSensorBad, (r) => r.sensorId), all = counts(perSensorAll, (r) => r.sensorId), life = counts(allSensorAnomalies, (r) => r.sensorId);
      res.json({
        hours, kpis: { totalSensors: sensorsTotal, activeSensors: sensorsActive, totalTelemetry: telemetryTotal, trustedReadings: trusted, anomaliesDetected: anomalies, blockedRequests: blocked },
        telemetryVolume: volume.map((v) => ({ t: v.bucket, total: Number(v.total), anomalous: Number(v.anomalous), normal: Number(v.total) - Number(v.anomalous) })),
        incidentsBySeverity: (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((s) => ({ severity: s, count: counts(severity, (r) => r.severity)[s] ?? 0 })),
        sensorActivity: sensors.map((s) => ({ sensorId: s.sensorId, readings: all[s.sensorId] ?? 0, anomalous: bad[s.sensorId] ?? 0 })),
        scoreDistribution: scores, recentEvents: recent,
        sensorHealth: sensors.map((s) => ({ ...s, anomalies: life[s.sensorId] ?? 0 })),
      });
    },

    async model(_req: Request, res: Response) {
      const [latest, history] = await Promise.all([db.modelMetrics.findFirst({ orderBy: { trainedAt: 'desc' } }),
        db.modelMetrics.findMany({ orderBy: { trainedAt: 'desc' }, take: 10, select: { id: true, modelName: true, precision: true, recall: true, f1Score: true, trainedAt: true, datasetVersion: true } })]);
      const d = (latest?.details ?? null) as any;
      res.json({
        metrics: latest ? { modelName: latest.modelName, trainedAt: latest.trainedAt, datasetVersion: latest.datasetVersion, precision: latest.precision, recall: latest.recall, f1Score: latest.f1Score,
          rocAuc: d?.roc_auc ?? null, averagePrecision: d?.average_precision ?? null, datasetSize: d ? { fit: d.fit_rows, calibration: d.calibration_rows, test: d.test_rows, testAnomalies: d.test_anomaly_rows } : null,
          operatingPoints: d?.operating_points ?? null, byType: d?.by_type ?? null, featureImportance: d?.permutation_importance ?? null } : null,
        info: { algorithm: 'Isolation Forest (scikit-learn), unsupervised, trained on clean data only', features: d?.features ?? [], trainingData: 'SYNTHETIC IoT weather-station dataset (not real meteorological data)',
          thresholds: { flag: config.flagThreshold, quarantine: config.quarantineThreshold, meaning: 'percentiles of clean calibration scores' },
          featureImportanceMethod: 'Permutation importance (drop in average precision when one feature is shuffled); global and approximate', limitations: MODEL_LIMITATIONS },
        distribution: await scoreDistribution(db, new Date(Date.now() - 7 * 86_400_000)), history,
        message: latest ? undefined : 'No model metrics stored yet. Run scripts/evaluate_model.py, then POST /api/analytics/model/refresh.',
      });
    },

    async refreshModel(req: Request, res: Response) {
      const m = await ml('/metrics', 'GET'); const op = m?.operating_points?.flag;
      if (!op || typeof m.trained_at !== 'string' || !Number.isFinite(op.precision)) throw new HttpError(502, 'ML metrics response is malformed', 'ML_ERROR');
      const row = await db.modelMetrics.create({ data: { modelName: String(m.model), precision: op.precision, recall: op.recall, f1Score: op.f1, trainedAt: new Date(m.trained_at), datasetVersion: String(m.dataset_version), details: m } });
      await audit(db, req, { action: 'MODEL_METRICS_REFRESHED', targetType: 'ModelMetrics', targetId: row.id });
      res.status(201).json({ id: row.id });
    },

    async trainModel(req: Request, res: Response) {
      const r = await ml('/train', 'POST', 120_000);
      await audit(db, req, { action: 'MODEL_RETRAINED', targetType: 'Model', details: { datasetVersion: r?.dataset_version ?? null } });
      res.json({ ...r, note: 'Model retrained and reloaded. Run scripts/evaluate_model.py and refresh metrics to update the analytics page.' });
    },

    settings(_req: Request, res: Response) {
      res.json({ readOnly: true, note: 'Effective configuration (environment-driven). Change values in .env and restart; secrets are never shown.',
        security: { timestampWindowSeconds: config.timestampWindowSeconds, flagThreshold: config.flagThreshold, quarantineThreshold: config.quarantineThreshold, mlFailMode: config.mlFailMode,
          rangeViolationAction: config.rangeViolationAction, physicalLimits: config.limits },
        sessions: { jwtExpiresSeconds: config.jwtExpiresSeconds, cookieSecure: config.cookieSecure, corsOrigin: config.corsOrigin },
        rateLimits: { windowMs: config.rateLimitWindowMs, global: config.rateLimitMax, loginFailures: config.authRateLimitMax, ingest: config.ingestRateLimitMax },
        integrations: { mlService: config.mlServiceUrl, mlTokenConfigured: Boolean(config.mlInternalToken), externalForecastingConfigured: Boolean(config.forecastingUrl), simulatorConfigured: Boolean(config.simulatorUrl) } });
    },

    async audit(req: Request, res: Response) {
      const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
        action: z.string().max(64).optional(), targetType: z.string().max(64).optional() }).strict().parse(req.query);
      const where = { ...(q.action ? { action: q.action } : {}), ...(q.targetType ? { targetType: q.targetType } : {}) };
      const [items, total] = await Promise.all([db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), db.auditLog.count({ where })]);
      res.json({ items, total, page: q.page, pageSize: q.pageSize });
    },
  };
}
