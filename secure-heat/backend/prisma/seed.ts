/**
 * Development seed. ALL telemetry/events created here are SYNTHETIC (clearly marked "[seed]"), not real weather data.
 * - Creates users from environment-configured credentials (no hardcoded passwords).
 * - Registers 5 demo sensors and writes their one-time credentials to SENSOR_CREDENTIALS_PATH (gitignored) for the simulator.
 * - Inserts 24h of synthetic history so the dashboard is populated on first run. (The simulator itself always uses the real ingest API.)
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config/env.js';
import { encryptSecret, generateApiKey, generateSecret, hashApiKey } from '../src/utils/crypto.js';

const db = new PrismaClient();
const config = loadConfig();
const CRED_PATH = process.env.SENSOR_CREDENTIALS_PATH ?? '../sensor-simulator/credentials.json';
const ML_METRICS_PATH = process.env.ML_METRICS_PATH ?? '../ml-service/models/metrics.json';

const SENSORS = [
  { sensorId: 'WS-001', name: 'North Campus Rooftop', location: 'North Campus, Building A roof', latitude: 19.0821, longitude: 72.8812, base: 24, amp: 3, press: 1012 },
  { sensorId: 'WS-002', name: 'Library Courtyard', location: 'Central Library courtyard', latitude: 19.0765, longitude: 72.8777, base: 21, amp: 4, press: 1009 },
  { sensorId: 'WS-003', name: 'Sports Ground', location: 'East sports ground', latitude: 19.0701, longitude: 72.8905, base: 27, amp: 2, press: 1014 },
  { sensorId: 'WS-004', name: 'Hill Station', location: 'Observatory hill', latitude: 19.0952, longitude: 72.8688, base: 18, amp: 5, press: 1005 },
  { sensorId: 'WS-005', name: 'Lake Edge', location: 'Campus lake, west bank', latitude: 19.0634, longitude: 72.8591, base: 25, amp: 3, press: 1011 },
];

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(42);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

function requireEnv(k: string, minLen = 1): string {
  const v = process.env[k]; if (!v || v.length < minLen) throw new Error(`${k} must be set${minLen > 1 ? ` (min ${minLen} chars)` : ''}`); return v;
}

async function seedUsers() {
  const defs: { name: string; role: 'ADMIN' | 'SECURITY_ANALYST' | 'VIEWER'; email?: string; pw?: string }[] = [
    { name: 'Administrator', role: 'ADMIN', email: requireEnv('SEED_ADMIN_EMAIL'), pw: requireEnv('SEED_ADMIN_PASSWORD', 12) },
    { name: 'Security Analyst', role: 'SECURITY_ANALYST', email: process.env.SEED_ANALYST_EMAIL, pw: process.env.SEED_ANALYST_PASSWORD },
    { name: 'Viewer', role: 'VIEWER', email: process.env.SEED_VIEWER_EMAIL, pw: process.env.SEED_VIEWER_PASSWORD },
  ];
  for (const d of defs) {
    if (!d.email || !d.pw) continue;
    if (d.pw.length < 12) throw new Error(`password for ${d.email} must be at least 12 characters`);
    // existing accounts keep their current password; the seed never overwrites credentials
    await db.user.upsert({ where: { email: d.email.toLowerCase() }, update: { role: d.role }, create: { name: d.name, email: d.email.toLowerCase(), role: d.role, passwordHash: await bcrypt.hash(d.pw, 12) } });
    console.log(`user ready: ${d.email} (${d.role})`);
  }
}

async function seedSensors() {
  const creds: Record<string, { apiKey: string; secret: string }> = existsSync(CRED_PATH) ? JSON.parse(readFileSync(CRED_PATH, 'utf8')) : {};
  for (const s of SENSORS) {
    const exists = await db.sensor.findUnique({ where: { sensorId: s.sensorId } });
    if (exists && creds[s.sensorId]) continue;                       // already provisioned and the simulator has its credentials
    const apiKey = generateApiKey(), secret = generateSecret();       // new sensor, or credentials file missing -> (re)issue
    const data = { apiKeyHash: hashApiKey(apiKey), secretKey: encryptSecret(secret, config.sensorSecretEncKey) };
    if (exists) await db.sensor.update({ where: { sensorId: s.sensorId }, data });
    else await db.sensor.create({ data: { sensorId: s.sensorId, name: s.name, location: s.location, latitude: s.latitude, longitude: s.longitude, ...data } });
    creds[s.sensorId] = { apiKey, secret };
    console.log(`sensor ${exists ? 'credentials re-issued' : 'registered'}: ${s.sensorId}`);
  }
  writeFileSync(CRED_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
  console.log(`sensor credentials written to ${CRED_PATH} (gitignored; shown only here)`);
}

async function seedTelemetry() {
  if ((await db.telemetry.count()) > 0) { console.log('telemetry already present; skipping synthetic history'); return; }
  const admin = await db.user.findFirst({ where: { role: 'ADMIN' } });
  const STEP = 10 * 60_000, N = 144, end = Math.floor(Date.now() / STEP) * STEP - STEP, start = end - (N - 1) * STEP;
  type Row = Prisma.TelemetryCreateManyInput; type Ev = Prisma.SecurityEventCreateManyInput;
  const rows: Row[] = [], events: Ev[] = [], replay: Prisma.ReplayRecordCreateManyInput[] = [];

  for (const s of SENSORS) {
    let prevRepeat: Row | null = null;
    for (let i = 0; i < N; i++) {
      const ts = new Date(start + i * STEP), hr = ts.getUTCHours() + ts.getUTCMinutes() / 60;
      const day = Math.sin(((hr - 9) / 24) * 2 * Math.PI);
      let temperature = s.base + s.amp * 2 * day + gauss() * 0.3;
      let humidity = Math.min(99, Math.max(15, 65 - 3 * (temperature - s.base) + gauss() * 1.5));
      let pressure = s.press + 1.2 * Math.sin((hr / 12) * 2 * Math.PI) + gauss() * 0.25;
      let windSpeed = Math.max(0, 4 + 2.5 * Math.max(day, 0) + gauss() * 0.8);
      const solarRadiation = Math.max(0, 900 * Math.sin(((hr - 6) / 12) * Math.PI)) * (0.7 + rand() * 0.2) * (hr > 6 && hr < 18 ? 1 : 0);
      const id = randomUUID(); let anomalyScore: number | null = Math.pow(rand(), 0.5) * 0.95; let decision: 'ACCEPT' | 'FLAG' | 'QUARANTINE' = 'ACCEPT';
      let explanation: string | null = 'Reading is consistent with this sensor\'s learned normal behaviour'; let ev: Omit<Ev, 'telemetryId' | 'sensorId' | 'id'> | null = null;
      let rules: object[] = []; let status: 'NORMAL' | 'ANOMALY' | 'UNKNOWN' = 'NORMAL';

      const roll = rand();
      if (roll < 0.012) { temperature += 18; anomalyScore = 0.9996; decision = 'QUARANTINE'; explanation = 'temperature deviates +9.1σ from this sensor\'s typical value for this hour';
        rules = [{ rule: 'TEMPERATURE_SUDDEN_CHANGE', category: 'change', severity: 'MEDIUM', hard: false, message: 'temperature changed by +18.0 vs recent median' }];
        ev = { eventType: 'ANOMALOUS_TELEMETRY', severity: 'CRITICAL', description: `[seed] QUARANTINE: ${explanation} (anomaly score 0.9996)` }; }
      else if (roll < 0.024) { humidity = rand() < 0.5 ? 97 : 9; anomalyScore = 0.9946; decision = 'FLAG'; explanation = 'humidity deviates unusually from this sensor\'s typical value for this hour';
        ev = { eventType: 'ANOMALOUS_TELEMETRY', severity: 'LOW', description: `[seed] FLAG: ${explanation} (anomaly score 0.9946)` }; }
      else if (roll < 0.03) { humidity = 150; anomalyScore = null; decision = 'QUARANTINE'; status = 'UNKNOWN'; explanation = 'humidity=150 is outside the allowed range [0, 100]';
        rules = [{ rule: 'HUMIDITY_OUT_OF_RANGE', category: 'range', severity: 'HIGH', hard: true, message: explanation }];
        ev = { eventType: 'RULE_VIOLATION', severity: 'HIGH', description: `[seed] QUARANTINE: ${explanation}` }; }
      else if (roll < 0.036) { windSpeed += 32; anomalyScore = 0.9993; decision = 'QUARANTINE'; explanation = 'wind speed deviates +11.0σ from this sensor\'s typical value for this hour';
        ev = { eventType: 'ANOMALOUS_TELEMETRY', severity: 'HIGH', description: `[seed] QUARANTINE: ${explanation} (anomaly score 0.9993)` }; }
      if (decision !== 'ACCEPT' && status === 'NORMAL') status = 'ANOMALY';

      const row: Row = { id, sensorId: s.sensorId, sequenceNumber: i + 1, temperature: +temperature.toFixed(2), humidity: +humidity.toFixed(1), pressure: +pressure.toFixed(2), windSpeed: +windSpeed.toFixed(2),
        windDirection: Math.round((180 + 60 * Math.sin(i / 20) + gauss() * 8 + 360) % 360), rainfall: rand() < 0.03 ? +(rand() * 2).toFixed(2) : 0, solarRadiation: Math.round(solarRadiation),
        timestamp: ts, receivedAt: ts, signatureValid: true, anomalyScore, anomalyStatus: status, decision,
        processingStatus: decision === 'ACCEPT' ? 'FORWARDED' : 'QUARANTINED', rulesTriggered: rules as Prisma.InputJsonValue, explanation };
      // a short stuck-sensor run on WS-004 to exercise the repeated-readings path
      if (s.sensorId === 'WS-004' && i >= 100 && i <= 103 && decision === 'ACCEPT') {
        if (i === 100) prevRepeat = row;
        else { Object.assign(row, { temperature: prevRepeat!.temperature, humidity: prevRepeat!.humidity, pressure: prevRepeat!.pressure, windSpeed: prevRepeat!.windSpeed, windDirection: prevRepeat!.windDirection, rainfall: prevRepeat!.rainfall, solarRadiation: prevRepeat!.solarRadiation });
          if (i >= 102) { Object.assign(row, { decision: 'FLAG', processingStatus: 'QUARANTINED', anomalyStatus: 'ANOMALY', explanation: `${i - 100 + 1} consecutive identical readings`, rulesTriggered: [{ rule: 'REPEATED_IDENTICAL_READINGS', category: 'repeat', severity: 'MEDIUM', hard: false, message: `${i - 100 + 1} consecutive identical readings` }] });
            ev = { eventType: 'REPEATED_READINGS', severity: 'MEDIUM', description: `[seed] FLAG: ${i - 100 + 1} consecutive identical readings` }; } } }
      rows.push(row); replay.push({ sensorId: s.sensorId, sequenceNumber: i + 1, timestamp: ts, receivedAt: ts });
      if (ev) events.push({ ...ev, sensorId: s.sensorId, telemetryId: id, sourceIP: '10.0.0.' + (10 + SENSORS.indexOf(s)), detectedAt: ts, status: 'OPEN' });
    }
  }
  // authentication-layer incidents (no telemetry rows exist for these: they were rejected before storage)
  const at = (minAgo: number) => new Date(end - minAgo * 60_000);
  events.push(
    { eventType: 'REPLAY_ATTACK', severity: 'HIGH', sensorId: 'WS-003', description: '[seed] Duplicate sequence number 88 for sensor WS-003: replayed request', sourceIP: '203.0.113.17', detectedAt: at(400) },
    { eventType: 'REPLAY_ATTACK', severity: 'MEDIUM', sensorId: 'WS-003', description: '[seed] Timestamp is 640s from server time (allowed ±120s): stale or future-dated request', sourceIP: '203.0.113.17', detectedAt: at(395) },
    { eventType: 'INVALID_SIGNATURE', severity: 'HIGH', sensorId: 'WS-002', description: '[seed] HMAC signature verification failed for sensor WS-002 (sequence 51)', sourceIP: '198.51.100.23', detectedAt: at(300) },
    { eventType: 'INVALID_SIGNATURE', severity: 'HIGH', sensorId: 'WS-002', description: '[seed] HMAC signature verification failed for sensor WS-002 (sequence 52)', sourceIP: '198.51.100.23', detectedAt: at(299) },
    { eventType: 'AUTHENTICATION_FAILURE', severity: 'MEDIUM', sensorId: null, claimedSensorId: 'WS-099', description: '[seed] Telemetry from unknown sensor id "WS-099"', sourceIP: '192.0.2.44', detectedAt: at(120) },
    { eventType: 'AUTHENTICATION_FAILURE', severity: 'HIGH', sensorId: 'WS-005', description: '[seed] Invalid or missing API key for sensor WS-005', sourceIP: '192.0.2.45', detectedAt: at(60) },
  );
  // older incidents are marked resolved so the dashboard shows a realistic mix of states
  events.forEach((e, k) => { if (new Date(e.detectedAt as Date).getTime() < end - 20 * 3600_000 || k % 7 === 0) Object.assign(e, { status: 'RESOLVED', resolvedAt: new Date(end), investigatedById: admin?.id ?? null, resolutionNotes: '[seed] Reviewed: no further action required.' }); });

  await db.sensor.updateMany({ data: { lastSeen: new Date(end) } });
  await db.telemetry.createMany({ data: rows }); await db.replayRecord.createMany({ data: replay });
  await db.securityEvent.createMany({ data: events });
  console.log(`seeded ${rows.length} SYNTHETIC telemetry rows, ${events.length} security events`);
}

async function loadMlMetrics(): Promise<any | null> {
  if (existsSync(ML_METRICS_PATH)) return JSON.parse(readFileSync(ML_METRICS_PATH, 'utf8'));
  try {   // separate containers: ask the ML service instead
    const r = await fetch(`${config.mlServiceUrl}/metrics`, { headers: config.mlInternalToken ? { 'x-internal-token': config.mlInternalToken } : {}, signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function seedModelMetrics() {
  if ((await db.modelMetrics.count()) > 0) return;
  const m = await loadMlMetrics(); const op = m?.operating_points?.flag;
  if (!op) { console.log('ML metrics not available yet; use "Refresh metrics" on the ML Analytics page later'); return; }
  await db.modelMetrics.create({ data: { modelName: m.model, precision: op.precision, recall: op.recall, f1Score: op.f1, trainedAt: new Date(m.trained_at), datasetVersion: m.dataset_version, details: m } });
  console.log('imported ML metrics');
}

try { await seedUsers(); await seedSensors(); await seedTelemetry(); await seedModelMetrics(); }
finally { await db.$disconnect(); }
