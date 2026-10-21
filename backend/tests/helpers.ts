import { canonicalString, encryptSecret, generateApiKey, generateSecret, hashApiKey, signCanonical } from '../src/utils/crypto.js';
import type { IngestRepo, MlClient, Forwarder, SensorRecord, SecurityEventInsert, TelemetryInsert } from '../src/services/ports.js';
import { MlUnavailableError } from '../src/services/ports.js';
import type { PipelineConfig, IngestInput } from '../src/services/ingestPipeline.js';
import type { MlResult, ProcessingStatus } from '../src/types.js';

export const ENC_KEY = Buffer.alloc(32, 7);
export const NOW = Date.parse('2026-10-16T10:00:00Z');
export const CONFIG: PipelineConfig = {
  flagThreshold: 0.99, quarantineThreshold: 0.999, mlFailMode: 'quarantine', rangeViolationAction: 'quarantine',
  timestampWindowSeconds: 120, sensorSecretEncKey: ENC_KEY,
  limits: { temperature: [-60, 60], humidity: [0, 100], pressure: [870, 1085], windSpeed: [0, 75], windDirection: [0, 360], rainfall: [0, 100], solarRadiation: [0, 1500] },
};

export class FakeRepo implements IngestRepo {
  sensors = new Map<string, SensorRecord>(); claimed = new Set<string>();
  telemetry: (TelemetryInsert & { id: string })[] = []; events: (SecurityEventInsert & { id: string })[] = []; touched: string[] = [];
  async findSensor(id: string) { return this.sensors.get(id) ?? null; }
  async claimSequence(sensorId: string, seq: number) { const k = `${sensorId}:${seq}`; if (this.claimed.has(k)) return false; this.claimed.add(k); return true; } // sync check+add == atomic
  async saveTelemetry(t: TelemetryInsert) { const id = `t${this.telemetry.length + 1}`; this.telemetry.push({ ...t, id }); return { id }; }
  async setTelemetryStatus(id: string, s: ProcessingStatus) { const t = this.telemetry.find((x) => x.id === id)!; t.processingStatus = s; }
  async createEvent(e: SecurityEventInsert) { const id = `e${this.events.length + 1}`; this.events.push({ ...e, id }); return { id }; }
  async touchSensor(id: string) { this.touched.push(id); }
}
export class FakeForwarder implements Forwarder { forwarded: string[] = []; fail = false;
  async forward(t: { telemetryId: string }) { if (this.fail) throw new Error('down'); this.forwarded.push(t.telemetryId); } }
export class StubMl implements MlClient {
  calls = 0; down = false;
  constructor(public result: Partial<MlResult> = {}) {}
  async predict(): Promise<MlResult> {
    this.calls++; if (this.down) throw new MlUnavailableError('connection refused');
    return { anomalyScore: 0.3, prediction: 'NORMAL', mlSeverity: 'NONE', rulesTriggered: [], ruleDetails: [], hardRuleViolation: false, explanation: 'normal', ...this.result };
  }
}

export interface Fixture { repo: FakeRepo; fwd: FakeForwarder; ml: StubMl; apiKey: string; secret: string; deps: any; send: (over?: Record<string, unknown>, o?: { seq?: number; ts?: string; apiKey?: string | null; secret?: string; badSig?: boolean; raw?: string }) => IngestInput }

export function fixture(status: 'ACTIVE' | 'BLOCKED' | 'INACTIVE' = 'ACTIVE'): Fixture {
  const repo = new FakeRepo(), fwd = new FakeForwarder(), ml = new StubMl();
  const apiKey = generateApiKey(), secret = generateSecret();
  repo.sensors.set('WS-001', { id: 'db1', sensorId: 'WS-001', status, apiKeyHash: hashApiKey(apiKey), secretKeyEnc: encryptSecret(secret, ENC_KEY) });
  let seq = 0;
  const base = { temperature: 22, humidity: 60, pressure: 1012, windSpeed: 4, windDirection: 180, rainfall: 0, solarRadiation: 300 };
  const send: Fixture['send'] = (over = {}, o = {}) => {
    const sequenceNumber = o.seq ?? ++seq; const timestamp = o.ts ?? new Date(NOW).toISOString().replace('.000Z', 'Z');
    const body = { sensorId: 'WS-001', timestamp, sequenceNumber, ...base, ...over };
    const raw = o.raw ?? JSON.stringify(body);
    const sig = signCanonical(o.secret ?? secret, canonicalString('WS-001', timestamp, sequenceNumber, raw));
    return { apiKey: o.apiKey === null ? undefined : (o.apiKey ?? apiKey), signature: o.badSig ? 'f'.repeat(64) : sig, rawBody: Buffer.from(raw), body: JSON.parse(raw), sourceIP: '10.0.0.9' };
  };
  return { repo, fwd, ml, apiKey, secret, send, deps: { repo, ml, forwarder: fwd, config: CONFIG, now: () => NOW } };
}
