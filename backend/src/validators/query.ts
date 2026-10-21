import { z } from 'zod';

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO-8601 date').transform((s) => new Date(s));
const page = { page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(25) };
const sensorId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const order = z.enum(['asc', 'desc']).default('desc');

export const telemetryQuery = z.object({
  ...page, sensorId: sensorId.optional(), q: z.string().trim().max(64).optional(),
  processingStatus: z.enum(['PENDING', 'AUTHENTICATED', 'FORWARDED', 'QUARANTINED', 'REJECTED']).optional(),
  decision: z.enum(['ACCEPT', 'FLAG', 'QUARANTINE', 'REJECT']).optional(),
  from: isoDate.optional(), to: isoDate.optional(),
  sortBy: z.enum(['timestamp', 'sensorId', 'temperature', 'humidity', 'pressure', 'windSpeed', 'anomalyScore', 'decision']).default('timestamp'), order,
}).strict().refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be before to' });

export const eventQuery = z.object({
  ...page, sensorId: sensorId.optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(), status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED']).optional(),
  eventType: z.enum(['AUTHENTICATION_FAILURE', 'INVALID_SIGNATURE', 'REPLAY_ATTACK', 'INVALID_TELEMETRY', 'RULE_VIOLATION', 'ANOMALOUS_TELEMETRY', 'REPEATED_READINGS', 'SENSOR_DRIFT', 'BLOCKED_SENSOR', 'ML_SERVICE_FAILURE', 'SENSOR_FLAGGED']).optional(),
  from: isoDate.optional(), to: isoDate.optional(),
  sortBy: z.enum(['detectedAt', 'severity', 'eventType', 'status']).default('detectedAt'), order,
}).strict();

export const quarantineQuery = z.object({ ...page, sensorId: sensorId.optional(), state: z.enum(['pending', 'approved', 'rejected']).default('pending') }).strict();
export const trustedQuery = z.object({ sensorId: sensorId.optional(), from: isoDate.optional(), to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) }).strict();
export const trendsQuery = z.object({ sensorId: sensorId.optional(), hours: z.coerce.number().int().min(1).max(168).default(24), horizon: z.coerce.number().int().min(0).max(12).default(6) }).strict();
export const overviewQuery = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }).strict();

export const reviewBody = z.object({ notes: z.string().trim().min(3, 'a reason is required').max(1000) }).strict();
export const eventNoteBody = z.object({ note: z.string().trim().min(1).max(2000) }).strict();
export const resolveBody = z.object({ resolutionNotes: z.string().trim().min(3, 'resolution notes are required').max(2000) }).strict();
export const simScenarioBody = z.object({
  scenario: z.enum(['normal', 'temperature_spoof', 'humidity_manipulation', 'replay_attack', 'wind_spike', 'sensor_drift', 'forged_signature']),
  target: sensorId.optional(), ticks: z.number().int().min(0).max(1000).default(0), rate: z.number().gt(0).max(1).default(1),
}).strict();
