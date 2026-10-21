import type { PrismaClient, Sensor } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { audit } from '../services/audit.js';
import { encryptSecret, generateApiKey, generateSecret, hashApiKey } from '../utils/crypto.js';
import { HttpError, isUniqueViolation } from '../utils/errors.js';
import { markSuspiciousSchema, registerSensorSchema, sensorStatusSchema } from '../validators/schemas.js';

/** The ONLY serializer for sensors: apiKeyHash and secretKey can never reach a response. */
export const publicSensor = (s: Sensor) => ({ id: s.id, sensorId: s.sensorId, name: s.name, location: s.location, latitude: s.latitude, longitude: s.longitude,
  status: s.status, lastSeen: s.lastSeen, registeredAt: s.registeredAt, updatedAt: s.updatedAt });

export function sensorController(db: PrismaClient, config: AppConfig) {
  const newCredentials = () => { const apiKey = generateApiKey(), secret = generateSecret();
    return { apiKey, secret, apiKeyHash: hashApiKey(apiKey), secretKey: encryptSecret(secret, config.sensorSecretEncKey) }; };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');
  const get = async (req: Request) => {
    const s = await db.sensor.findUnique({ where: { sensorId: String(req.params.sensorId) } });
    if (!s) throw new HttpError(404, 'sensor not found', 'NOT_FOUND'); return s;
  };

  return {
    async list(_req: Request, res: Response) {
      const [sensors, totals, flagged] = await Promise.all([
        db.sensor.findMany({ orderBy: { sensorId: 'asc' } }),
        db.telemetry.groupBy({ by: ['sensorId'], _count: { _all: true } }),
        db.telemetry.groupBy({ by: ['sensorId'], where: { decision: { not: 'ACCEPT' } }, _count: { _all: true } }),
      ]);
      const t = new Map(totals.map((x) => [x.sensorId, x._count._all])), a = new Map(flagged.map((x) => [x.sensorId, x._count._all]));
      res.json({ sensors: sensors.map((s) => ({ ...publicSensor(s), telemetryCount: t.get(s.sensorId) ?? 0, anomalyCount: a.get(s.sensorId) ?? 0 })) });
    },

    async detail(req: Request, res: Response) {
      const s = await get(req);
      const [telemetryCount, anomalyCount, openEvents, recentEvents] = await Promise.all([
        db.telemetry.count({ where: { sensorId: s.sensorId } }), db.telemetry.count({ where: { sensorId: s.sensorId, decision: { not: 'ACCEPT' } } }),
        db.securityEvent.count({ where: { sensorId: s.sensorId, status: { not: 'RESOLVED' } } }),
        db.securityEvent.findMany({ where: { sensorId: s.sensorId }, orderBy: { detectedAt: 'desc' }, take: 10,
          select: { id: true, eventType: true, severity: true, status: true, detectedAt: true, description: true } }),
      ]);
      res.json({ sensor: { ...publicSensor(s), telemetryCount, anomalyCount, openEvents }, recentEvents });
    },

    async register(req: Request, res: Response) {
      const b = registerSensorSchema.parse(req.body); const c = newCredentials();
      try {
        const s = await db.sensor.create({ data: { sensorId: b.sensorId, name: b.name, location: b.location, latitude: b.latitude, longitude: b.longitude, apiKeyHash: c.apiKeyHash, secretKey: c.secretKey } });
        await audit(db, req, { action: 'SENSOR_REGISTERED', targetType: 'Sensor', targetId: s.sensorId, details: { name: s.name, location: s.location } });
        noStore(res); res.status(201).json({ sensor: publicSensor(s), credentials: { apiKey: c.apiKey, secret: c.secret }, notice: 'Store these credentials now. They are shown only once and cannot be retrieved later.' });
      } catch (e) {
        if (isUniqueViolation(e)) throw new HttpError(409, 'sensor id already registered', 'SENSOR_EXISTS');
        throw e;
      }
    },

    async setStatus(req: Request, res: Response) {
      const s = await get(req); const b = sensorStatusSchema.parse(req.body);
      const updated = await db.sensor.update({ where: { id: s.id }, data: { status: b.status } });
      await audit(db, req, { action: 'SENSOR_STATUS_CHANGED', targetType: 'Sensor', targetId: s.sensorId, details: { from: s.status, to: b.status, reason: b.reason ?? null } });
      res.json({ sensor: publicSensor(updated) });
    },

    /** Old credentials stop working immediately. New ones are returned once. */
    async rotate(req: Request, res: Response) {
      const s = await get(req); const c = newCredentials();
      const updated = await db.sensor.update({ where: { id: s.id }, data: { apiKeyHash: c.apiKeyHash, secretKey: c.secretKey } });
      await audit(db, req, { action: 'SENSOR_CREDENTIALS_ROTATED', targetType: 'Sensor', targetId: s.sensorId });
      noStore(res); res.json({ sensor: publicSensor(updated), credentials: { apiKey: c.apiKey, secret: c.secret }, notice: 'Previous credentials are now invalid. Store these now; they are shown only once.' });
    },

    /** Analysts can flag a sensor for investigation; its readings are then held for review rather than auto-trusted. */
    async markSuspicious(req: Request, res: Response) {
      const s = await get(req); const b = markSuspiciousSchema.parse(req.body);
      if (s.status === 'BLOCKED' || s.status === 'INACTIVE') throw new HttpError(409, `sensor is ${s.status.toLowerCase()}; admin must reactivate it first`, 'INVALID_STATE');
      const [updated] = await db.$transaction([
        db.sensor.update({ where: { id: s.id }, data: { status: 'SUSPICIOUS' } }),
        db.securityEvent.create({ data: { eventType: 'SENSOR_FLAGGED', severity: 'MEDIUM', sensorId: s.sensorId, status: 'INVESTIGATING', investigatedById: req.user!.id,
          sourceIP: req.ip?.slice(0, 64) ?? null, description: `Sensor ${s.sensorId} marked suspicious by ${req.user!.email}: ${b.reason}` } }),
      ]);
      await audit(db, req, { action: 'SENSOR_MARKED_SUSPICIOUS', targetType: 'Sensor', targetId: s.sensorId, details: { reason: b.reason } });
      res.json({ sensor: publicSensor(updated) });
    },
  };
}
