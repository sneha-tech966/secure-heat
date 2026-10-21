import { READING_FIELDS, type Reading, type ReadingField, type RuleDetail } from '../types.js';

export const MAX_SEQUENCE = 2_147_483_647; // fits PostgreSQL INTEGER
const SENSOR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export interface AuthFields { sensorId: string; timestamp: string; timestampMs: number; sequenceNumber: number }
export interface TelemetryRequest extends AuthFields { reading: Reading }
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Minimal parse of the fields needed to authenticate. Nothing else from the body is trusted until the signature verifies. */
export function parseAuthFields(body: unknown): Parsed<AuthFields> {
  if (!isObj(body)) return { ok: false, error: 'body must be a JSON object' };
  const { sensorId, timestamp, sequenceNumber } = body;
  if (typeof sensorId !== 'string' || !SENSOR_ID_RE.test(sensorId)) return { ok: false, error: 'invalid sensorId' };
  if (typeof timestamp !== 'string' || !ISO_RE.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return { ok: false, error: 'timestamp must be ISO-8601 with timezone' };
  if (typeof sequenceNumber !== 'number' || !Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0 || sequenceNumber > MAX_SEQUENCE) return { ok: false, error: `sequenceNumber must be an integer in [0, ${MAX_SEQUENCE}]` };
  return { ok: true, value: { sensorId, timestamp, timestampMs: Date.parse(timestamp), sequenceNumber } };
}

/** Strict schema validation (run after authentication). Unknown keys are rejected, which also blocks clients from
 *  smuggling in fields such as `anomalyScore`: the decision is always computed server-side. */
export function parseTelemetry(body: unknown): Parsed<TelemetryRequest> {
  const auth = parseAuthFields(body);
  if (!auth.ok) return auth;
  const b = body as Record<string, unknown>;
  const allowed = new Set<string>(['sensorId', 'timestamp', 'sequenceNumber', ...READING_FIELDS]);
  const extra = Object.keys(b).filter((k) => !allowed.has(k));
  if (extra.length) return { ok: false, error: `unexpected field(s): ${extra.slice(0, 5).join(', ')}` };
  const reading = {} as Reading;
  for (const f of READING_FIELDS) {
    const v = b[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${f} must be a finite number` };
    reading[f] = v;
  }
  return { ok: true, value: { ...auth.value, reading } };
}

/** Stateless physical-limit check. Out-of-range values are valid numbers but impossible measurements. */
export function checkRanges(reading: Reading, limits: Record<ReadingField, [number, number]>): RuleDetail[] {
  const out: RuleDetail[] = [];
  for (const f of READING_FIELDS) {
    const [lo, hi] = limits[f]; const v = reading[f];
    if (v < lo || v > hi) out.push({ rule: `${f.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}_OUT_OF_RANGE`, category: 'range', severity: 'HIGH', hard: true,
      message: `${f}=${v} is outside the allowed range [${lo}, ${hi}]` });
  }
  return out;
}
