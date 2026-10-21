import { decryptSecret, canonicalString, verifyApiKey, verifySignature } from '../utils/crypto.js';
import { checkRanges, parseAuthFields, parseTelemetry } from '../validators/telemetry.js';
import { decide, type DecisionConfig } from './decisionEngine.js';
import { MlUnavailableError, type Forwarder, type IngestRepo, type MlClient, type SecurityEventInsert } from './ports.js';
import type { Decision, MlResult, ProcessingStatus, ReadingField, RuleDetail } from '../types.js';

export interface PipelineConfig extends DecisionConfig {
  timestampWindowSeconds: number; sensorSecretEncKey: Buffer; limits: Record<ReadingField, [number, number]>;
}
export interface IngestDeps { repo: IngestRepo; ml: MlClient; forwarder: Forwarder; config: PipelineConfig; now?: () => number; log?: (msg: string, err?: unknown) => void }
export interface IngestInput { apiKey: string | undefined; signature: string | undefined; rawBody: Buffer; body: unknown; sourceIP: string }
export interface IngestResult {
  httpStatus: number;
  body: { status: ProcessingStatus | 'ERROR'; decision: Decision; code?: string; message?: string; telemetryId?: string; sequenceNumber?: number };
}

const AUTH_FAILED = { httpStatus: 401, body: { status: 'REJECTED', decision: 'REJECT', code: 'AUTHENTICATION_FAILED', message: 'authentication failed' } } as const satisfies IngestResult;
const reject = (httpStatus: number, code: string, message: string): IngestResult =>
  ({ httpStatus, body: { status: 'REJECTED', decision: 'REJECT', code, message } });
// dummy hash so unknown-sensor and wrong-key paths do comparable work (limits sensor enumeration by timing)
const DUMMY_HASH = '0'.repeat(64);

/**
 * Telemetry ingestion: identify sensor -> API key -> blocked? -> HMAC -> timestamp window -> atomic replay claim ->
 * strict schema -> physical-limit rules -> ML -> decision -> persist -> forward ONLY if ACCEPT.
 * Responses to the sensor are deliberately minimal (decision + id): a compromised sensor must not learn thresholds.
 * Anything that fails before the schema step is REJECTED and never stored as telemetry.
 */
export async function processTelemetry(deps: IngestDeps, input: IngestInput): Promise<IngestResult> {
  const { repo, ml, forwarder, config } = deps; const now = deps.now ?? Date.now; const log = deps.log ?? (() => {});
  const event = async (e: Omit<SecurityEventInsert, 'sourceIP'>) => {
    try { return (await repo.createEvent({ ...e, sourceIP: input.sourceIP })).id; } catch (err) { log('failed to write security event', err); return null; }
  };

  // 1. identify
  const af = parseAuthFields(input.body);
  if (!af.ok) {
    await event({ eventType: 'INVALID_TELEMETRY', severity: 'LOW', sensorId: null, description: `Malformed request before authentication: ${af.error}` });
    return reject(400, 'INVALID_REQUEST', 'malformed request');
  }
  const { sensorId, timestamp, timestampMs, sequenceNumber } = af.value;
  const sensor = await repo.findSensor(sensorId);

  // 2. API key
  const keyOk = verifyApiKey(input.apiKey ?? '', sensor?.apiKeyHash ?? DUMMY_HASH) && !!sensor && !!input.apiKey;
  if (!sensor || !keyOk) {
    await event({ eventType: 'AUTHENTICATION_FAILURE', severity: sensor ? 'HIGH' : 'MEDIUM', sensorId: sensor?.sensorId ?? null, claimedSensorId: sensorId,
      description: sensor ? `Invalid or missing API key for sensor ${sensorId}` : `Telemetry from unknown sensor id "${sensorId}"` });
    return AUTH_FAILED;
  }
  if (sensor.status === 'BLOCKED' || sensor.status === 'INACTIVE') {
    await event({ eventType: sensor.status === 'BLOCKED' ? 'BLOCKED_SENSOR' : 'AUTHENTICATION_FAILURE', severity: sensor.status === 'BLOCKED' ? 'HIGH' : 'LOW',
      sensorId, description: `Telemetry received from ${sensor.status.toLowerCase()} sensor ${sensorId}; rejected` });
    return reject(403, 'SENSOR_NOT_PERMITTED', 'sensor is not permitted to transmit');
  }

  // 3. HMAC signature over canonical string (binds sensor id, timestamp, sequence and the exact body bytes)
  let secret: string;
  try { secret = decryptSecret(sensor.secretKeyEnc, config.sensorSecretEncKey); }
  catch (err) { log('cannot decrypt sensor secret', err); return reject(500, 'INTERNAL_ERROR', 'internal error'); }
  const sigOk = !!input.signature && verifySignature(secret, canonicalString(sensorId, timestamp, sequenceNumber, input.rawBody), input.signature);
  if (!sigOk) {
    await event({ eventType: 'INVALID_SIGNATURE', severity: 'HIGH', sensorId, description: `HMAC signature verification failed for sensor ${sensorId} (sequence ${sequenceNumber})` });
    return AUTH_FAILED;
  }

  // 4. timestamp window
  const skewMs = Math.abs(now() - timestampMs);
  if (skewMs > config.timestampWindowSeconds * 1000) {
    await event({ eventType: 'REPLAY_ATTACK', severity: 'MEDIUM', sensorId,
      description: `Timestamp ${timestamp} is ${Math.round(skewMs / 1000)}s from server time (allowed ±${config.timestampWindowSeconds}s): stale or future-dated request` });
    return reject(409, 'TIMESTAMP_OUT_OF_WINDOW', 'timestamp outside accepted window');
  }

  // 5. replay protection: atomic claim of (sensorId, sequenceNumber)
  if (!(await repo.claimSequence(sensorId, sequenceNumber, new Date(timestampMs)))) {
    await event({ eventType: 'REPLAY_ATTACK', severity: 'HIGH', sensorId, description: `Duplicate sequence number ${sequenceNumber} for sensor ${sensorId}: replayed request` });
    return reject(409, 'REPLAY_DETECTED', 'sequence number already processed');
  }

  // 6. strict schema (the request is authenticated from here on)
  const parsed = parseTelemetry(input.body);
  if (!parsed.ok) {
    await event({ eventType: 'INVALID_TELEMETRY', severity: 'MEDIUM', sensorId, description: `Authenticated request failed validation: ${parsed.error}` });
    return reject(400, 'INVALID_PAYLOAD', 'payload failed validation');
  }
  const { reading } = parsed.value;
  await repo.touchSensor(sensorId).catch((e) => log('touchSensor failed', e));

  // 7-9. rules, ML, decision. Impossible values skip the ML call: the outcome cannot change, and the evidence is kept.
  const hardRules: RuleDetail[] = checkRanges(reading, config.limits);
  let mlResult: MlResult | null = null; let mlError: string | null = null;
  if (!hardRules.length) {
    try { mlResult = await ml.predict(sensorId, reading, timestamp); }
    catch (err) { mlError = err instanceof MlUnavailableError ? err.message : 'unexpected ML client error'; if (!(err instanceof MlUnavailableError)) log('ML client error', err); }
  }
  let d = decide({ hardRules, ml: mlResult, mlError, cfg: config });
  if (sensor.status === 'SUSPICIOUS' && d.decision === 'ACCEPT') {      // never auto-trust a sensor under investigation
    d = { decision: 'FLAG', processingStatus: 'QUARANTINED', eventType: 'SENSOR_FLAGGED', severity: 'LOW',
      reasons: ['Sensor is marked SUSPICIOUS and under investigation; readings are held for review'] };
  }

  // 10. persist (only ACCEPT starts as AUTHENTICATED; it becomes FORWARDED after the hand-off succeeds)
  const rules = [...hardRules, ...(mlResult?.ruleDetails ?? [])];
  const saved = await repo.saveTelemetry({
    sensorId, reading, timestamp: new Date(timestampMs), sequenceNumber, signatureValid: true,
    anomalyScore: mlResult?.anomalyScore ?? null, anomalyStatus: mlResult ? mlResult.prediction : 'UNKNOWN',
    processingStatus: d.processingStatus, decision: d.decision, rulesTriggered: rules, explanation: mlResult?.explanation ?? (d.reasons[0] ?? null),
  });

  // 11. security event for anything that is not a clean ACCEPT
  if (d.eventType && d.severity) {
    await event({ eventType: d.eventType, severity: d.severity, sensorId, telemetryId: saved.id,
      description: `${d.decision}: ${d.reasons.join(' | ')}${mlResult ? ` (anomaly score ${mlResult.anomalyScore.toFixed(4)})` : ''}` });
  }

  // 12. forward trusted data only
  if (d.decision === 'ACCEPT') {
    try {
      await forwarder.forward({ telemetryId: saved.id, sensorId, timestamp, reading });
      await repo.setTelemetryStatus(saved.id, 'FORWARDED');
      return { httpStatus: 201, body: { status: 'FORWARDED', decision: 'ACCEPT', telemetryId: saved.id, sequenceNumber } };
    } catch (err) {
      log('forwarding failed; reading stays AUTHENTICATED (not trusted)', err);
      return { httpStatus: 202, body: { status: 'AUTHENTICATED', decision: 'ACCEPT', code: 'FORWARDING_PENDING', telemetryId: saved.id, sequenceNumber } };
    }
  }
  const status = d.decision === 'REJECT' ? (mlError ? 503 : 422) : 202;
  return { httpStatus: status, body: { status: d.processingStatus, decision: d.decision, telemetryId: saved.id, sequenceNumber } };
}
