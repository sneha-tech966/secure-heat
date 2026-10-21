import type { Decision, EventType, MlResult, ProcessingStatus, Reading, Severity, SensorStatus, RuleDetail } from '../types.js';

export interface SensorRecord { id: string; sensorId: string; status: SensorStatus; apiKeyHash: string; secretKeyEnc: string }

export interface TelemetryInsert {
  sensorId: string; reading: Reading; timestamp: Date; sequenceNumber: number;
  signatureValid: boolean; anomalyScore: number | null; anomalyStatus: 'NORMAL' | 'ANOMALY' | 'UNKNOWN';
  processingStatus: ProcessingStatus; decision: Decision; rulesTriggered: RuleDetail[]; explanation: string | null;
}
export interface SecurityEventInsert {
  eventType: EventType; severity: Severity; description: string;
  sensorId: string | null; claimedSensorId?: string | null; telemetryId?: string | null; sourceIP: string;
}

/** Persistence boundary for the ingestion pipeline (Prisma in production, in-memory fake in unit tests). */
export interface IngestRepo {
  findSensor(sensorId: string): Promise<SensorRecord | null>;
  /** MUST be atomic: returns false (never throws) if (sensorId, sequenceNumber) was already claimed. */
  claimSequence(sensorId: string, sequenceNumber: number, timestamp: Date): Promise<boolean>;
  saveTelemetry(t: TelemetryInsert): Promise<{ id: string }>;
  setTelemetryStatus(id: string, status: ProcessingStatus): Promise<void>;
  createEvent(e: SecurityEventInsert): Promise<{ id: string }>;
  touchSensor(sensorId: string): Promise<void>;
}
export interface MlClient { predict(sensorId: string, reading: Reading, timestamp: string): Promise<MlResult> }
export interface Forwarder { forward(t: { telemetryId: string; sensorId: string; timestamp: string; reading: Reading }): Promise<void> }

export class MlUnavailableError extends Error {}
