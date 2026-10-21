import type { Prisma, PrismaClient } from '@prisma/client';
import type { IngestRepo, SecurityEventInsert, SensorRecord, TelemetryInsert } from './ports.js';
import type { ProcessingStatus } from '../types.js';
import { isUniqueViolation } from '../utils/errors.js';

/** Production implementation of the ingestion persistence boundary. */
export class PrismaIngestRepo implements IngestRepo {
  constructor(private readonly db: PrismaClient) {}

  async findSensor(sensorId: string): Promise<SensorRecord | null> {
    const s = await this.db.sensor.findUnique({ where: { sensorId }, select: { id: true, sensorId: true, status: true, apiKeyHash: true, secretKey: true } });
    return s ? { id: s.id, sensorId: s.sensorId, status: s.status, apiKeyHash: s.apiKeyHash, secretKeyEnc: s.secretKey } : null;
  }

  /** Single INSERT guarded by UNIQUE(sensorId, sequenceNumber): atomic under concurrency, no read-then-write race. */
  async claimSequence(sensorId: string, sequenceNumber: number, timestamp: Date): Promise<boolean> {
    try { await this.db.replayRecord.create({ data: { sensorId, sequenceNumber, timestamp } }); return true; }
    catch (e) { if (isUniqueViolation(e)) return false; throw e; }
  }

  async saveTelemetry(t: TelemetryInsert): Promise<{ id: string }> {
    return this.db.telemetry.create({
      select: { id: true },
      data: { sensorId: t.sensorId, sequenceNumber: t.sequenceNumber, ...t.reading, timestamp: t.timestamp, signatureValid: t.signatureValid,
        anomalyScore: t.anomalyScore, anomalyStatus: t.anomalyStatus, processingStatus: t.processingStatus, decision: t.decision,
        rulesTriggered: t.rulesTriggered as unknown as Prisma.InputJsonValue, explanation: t.explanation },
    });
  }

  async setTelemetryStatus(id: string, status: ProcessingStatus): Promise<void> { await this.db.telemetry.update({ where: { id }, data: { processingStatus: status } }); }

  async createEvent(e: SecurityEventInsert): Promise<{ id: string }> {
    return this.db.securityEvent.create({ select: { id: true },
      data: { eventType: e.eventType, severity: e.severity, description: e.description.slice(0, 2000), sensorId: e.sensorId, claimedSensorId: e.claimedSensorId?.slice(0, 64) ?? null,
        telemetryId: e.telemetryId ?? null, sourceIP: e.sourceIP.slice(0, 64) } });
  }

  async touchSensor(sensorId: string): Promise<void> { await this.db.sensor.update({ where: { sensorId }, data: { lastSeen: new Date() } }); }

  /** Replay records older than 2x the timestamp window can never be replayed successfully (the timestamp check rejects them first). */
  async purgeReplayRecords(olderThan: Date): Promise<number> { return (await this.db.replayRecord.deleteMany({ where: { timestamp: { lt: olderThan } } })).count; }
}
