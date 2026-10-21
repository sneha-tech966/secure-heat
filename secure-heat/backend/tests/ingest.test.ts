import test from 'node:test'; import assert from 'node:assert/strict';
import { processTelemetry } from '../src/services/ingestPipeline.js';
import { signCanonical, canonicalString } from '../src/utils/crypto.js';
import { CONFIG, NOW, fixture } from './helpers.js';

const types = (f: ReturnType<typeof fixture>) => f.repo.events.map((e) => e.eventType);

test('S1: legitimate sensor, normal reading -> ACCEPT, forwarded, no security event', async () => {
  const f = fixture(); const r = await processTelemetry(f.deps, f.send());
  assert.equal(r.httpStatus, 201); assert.equal(r.body.decision, 'ACCEPT'); assert.equal(r.body.status, 'FORWARDED');
  assert.equal(f.fwd.forwarded.length, 1); assert.equal(f.repo.telemetry[0]!.processingStatus, 'FORWARDED'); assert.equal(f.repo.events.length, 0);
  assert.deepEqual(f.repo.touched, ['WS-001']);
});
test('S2: manipulated temperature spike (strong ML score) -> QUARANTINE, never forwarded', async () => {
  const f = fixture(); f.ml.result = { anomalyScore: 0.9996, prediction: 'ANOMALY', explanation: 'temperature deviates +9σ' };
  const r = await processTelemetry(f.deps, f.send({ temperature: 44 }));
  assert.equal(r.httpStatus, 202); assert.equal(r.body.decision, 'QUARANTINE'); assert.equal(f.fwd.forwarded.length, 0);
  assert.equal(f.repo.telemetry[0]!.processingStatus, 'QUARANTINED'); assert.deepEqual(types(f), ['ANOMALOUS_TELEMETRY']); assert.equal(f.repo.events[0]!.severity, 'HIGH');
  assert.equal(f.repo.events[0]!.telemetryId, f.repo.telemetry[0]!.id);
});
test('S3: duplicate sequence number -> REJECT + REPLAY_ATTACK event, nothing stored or forwarded twice', async () => {
  const f = fixture(); await processTelemetry(f.deps, f.send({}, { seq: 5 }));
  const r = await processTelemetry(f.deps, f.send({}, { seq: 5 }));
  assert.equal(r.httpStatus, 409); assert.equal(r.body.decision, 'REJECT'); assert.deepEqual(types(f), ['REPLAY_ATTACK']);
  assert.equal(f.repo.telemetry.length, 1); assert.equal(f.fwd.forwarded.length, 1);
});
test('S3b: 20 simultaneous identical requests -> exactly one processed', async () => {
  const f = fixture(); const req = f.send({}, { seq: 9 });
  const results = await Promise.all(Array.from({ length: 20 }, () => processTelemetry(f.deps, req)));
  assert.equal(results.filter((x) => x.httpStatus === 201).length, 1); assert.equal(results.filter((x) => x.httpStatus === 409).length, 19);
  assert.equal(f.repo.telemetry.length, 1); assert.equal(f.fwd.forwarded.length, 1);
});
test('S4: invalid HMAC signature -> REJECT (401) + INVALID_SIGNATURE event, no telemetry, ML never called', async () => {
  const f = fixture(); const r = await processTelemetry(f.deps, f.send({}, { badSig: true }));
  assert.equal(r.httpStatus, 401); assert.deepEqual(types(f), ['INVALID_SIGNATURE']); assert.equal(f.repo.telemetry.length, 0); assert.equal(f.ml.calls, 0);
});
test('S4b: valid key but signed with the wrong secret, or body altered after signing -> invalid signature', async () => {
  const f = fixture(); const a = await processTelemetry(f.deps, f.send({}, { secret: 'ff'.repeat(32) }));
  const good = f.send(); const tampered = { ...good, rawBody: Buffer.from(good.rawBody.toString().replace('"temperature":22', '"temperature":23')), body: { ...(good.body as object), temperature: 23 } };
  const b = await processTelemetry(f.deps, tampered);
  assert.equal(a.httpStatus, 401); assert.equal(b.httpStatus, 401); assert.deepEqual(types(f), ['INVALID_SIGNATURE', 'INVALID_SIGNATURE']);
});
test('S4c: signature must bind the sequence: replaying a captured signature with a new sequence fails', async () => {
  const f = fixture(); const captured = f.send({}, { seq: 1 });
  const forged = { ...captured, body: { ...(captured.body as object), sequenceNumber: 2 }, rawBody: Buffer.from(captured.rawBody.toString().replace('"sequenceNumber":1', '"sequenceNumber":2')) };
  assert.equal((await processTelemetry(f.deps, forged)).httpStatus, 401);
});
test('S5: humidity=150 -> quarantined (configurable to reject), ML skipped, never forwarded', async () => {
  const f = fixture(); const r = await processTelemetry(f.deps, f.send({ humidity: 150 }));
  assert.equal(r.body.decision, 'QUARANTINE'); assert.equal(f.ml.calls, 0); assert.equal(f.fwd.forwarded.length, 0); assert.deepEqual(types(f), ['RULE_VIOLATION']);
  assert.equal(f.repo.telemetry[0]!.anomalyStatus, 'UNKNOWN'); assert.match(f.repo.telemetry[0]!.rulesTriggered[0]!.rule, /HUMIDITY_OUT_OF_RANGE/);
  const g = fixture(); g.deps.config = { ...CONFIG, rangeViolationAction: 'reject' };
  const r2 = await processTelemetry(g.deps, g.send({ humidity: 150 })); assert.equal(r2.body.decision, 'REJECT'); assert.equal(r2.httpStatus, 422);
});
test('S6: unusual but physically possible weather -> FLAG for review (held), LOW severity, not labelled malicious', async () => {
  const f = fixture(); f.ml.result = { anomalyScore: 0.992, prediction: 'ANOMALY', explanation: 'pressure deviates -4.1σ' };
  const r = await processTelemetry(f.deps, f.send({ pressure: 975, windSpeed: 18, rainfall: 9 }));
  assert.equal(r.body.decision, 'FLAG'); assert.equal(f.fwd.forwarded.length, 0); assert.equal(f.repo.telemetry[0]!.processingStatus, 'QUARANTINED');
  assert.equal(f.repo.events[0]!.severity, 'LOW'); assert.ok(!/attack|spoof|malicious/i.test(f.repo.events[0]!.description));
});
test('unknown sensor and wrong API key are indistinguishable to the caller (no enumeration)', async () => {
  const f = fixture(); const bad = await processTelemetry(f.deps, f.send({}, { apiKey: 'sh_wrong' }));
  const none = await processTelemetry(f.deps, f.send({}, { apiKey: null }));
  const unknownReq = f.send({ sensorId: 'WS-999' }); const unknown = await processTelemetry(f.deps, unknownReq);
  assert.deepEqual(bad, none); assert.deepEqual(bad, unknown); assert.equal(bad.httpStatus, 401);
  assert.deepEqual(types(f), ['AUTHENTICATION_FAILURE', 'AUTHENTICATION_FAILURE', 'AUTHENTICATION_FAILURE']);
  assert.equal(f.repo.events[2]!.sensorId, null); assert.equal(f.repo.events[2]!.claimedSensorId, 'WS-999');
});
test('stale and future timestamps -> 409 + REPLAY_ATTACK; sequence is not burned', async () => {
  const f = fixture(); const stale = new Date(NOW - 10 * 60_000).toISOString(), fut = new Date(NOW + 10 * 60_000).toISOString();
  assert.equal((await processTelemetry(f.deps, f.send({}, { ts: stale }))).httpStatus, 409);
  assert.equal((await processTelemetry(f.deps, f.send({}, { ts: fut }))).httpStatus, 409);
  assert.deepEqual(types(f), ['REPLAY_ATTACK', 'REPLAY_ATTACK']); assert.equal(f.repo.claimed.size, 0);
});
test('blocked sensor -> 403 + BLOCKED_SENSOR event; inactive sensor -> 403; neither reaches ML', async () => {
  const b = fixture('BLOCKED'); const rb = await processTelemetry(b.deps, b.send());
  assert.equal(rb.httpStatus, 403); assert.deepEqual(types(b), ['BLOCKED_SENSOR']); assert.equal(b.ml.calls, 0);
  const i = fixture('INACTIVE'); assert.equal((await processTelemetry(i.deps, i.send())).httpStatus, 403);
});
test('authenticated but invalid payload (e.g. smuggled anomalyScore) -> 400, not stored, not forwarded', async () => {
  const f = fixture(); const r = await processTelemetry(f.deps, f.send({ anomalyScore: 0 }));
  assert.equal(r.httpStatus, 400); assert.deepEqual(types(f), ['INVALID_TELEMETRY']); assert.equal(f.repo.telemetry.length, 0); assert.equal(f.ml.calls, 0);
  const g = fixture(); assert.equal((await processTelemetry(g.deps, g.send({ temperature: 'hot' }))).httpStatus, 400);
});
test('malformed unauthenticated request -> 400 and a LOW event, never a crash', async () => {
  const f = fixture(); const r = await processTelemetry(f.deps, { apiKey: f.apiKey, signature: 'x', rawBody: Buffer.from('[]'), body: [], sourceIP: '1.2.3.4' });
  assert.equal(r.httpStatus, 400); assert.equal(f.repo.events[0]!.severity, 'LOW');
});
test('ML outage -> fail-safe QUARANTINE (default) or REJECT 503; never forwarded', async () => {
  const f = fixture(); f.ml.down = true; const r = await processTelemetry(f.deps, f.send());
  assert.equal(r.body.decision, 'QUARANTINE'); assert.equal(f.fwd.forwarded.length, 0); assert.deepEqual(types(f), ['ML_SERVICE_FAILURE']);
  const g = fixture(); g.ml.down = true; g.deps.config = { ...CONFIG, mlFailMode: 'reject' };
  const r2 = await processTelemetry(g.deps, g.send()); assert.equal(r2.httpStatus, 503); assert.equal(g.repo.telemetry[0]!.processingStatus, 'REJECTED');
});
test('forwarding failure leaves the reading AUTHENTICATED (not trusted)', async () => {
  const f = fixture(); f.fwd.fail = true; const r = await processTelemetry(f.deps, f.send());
  assert.equal(r.body.status, 'AUTHENTICATED'); assert.equal(f.repo.telemetry[0]!.processingStatus, 'AUTHENTICATED');
});
test('responses never leak scores, explanations, thresholds or secrets to the sensor', async () => {
  const f = fixture(); f.ml.result = { anomalyScore: 0.9996, prediction: 'ANOMALY', explanation: 'SECRET-EXPLANATION' };
  const r = await processTelemetry(f.deps, f.send()); const s = JSON.stringify(r);
  assert.ok(!/0\.9996|SECRET-EXPLANATION|threshold|anomalyScore/i.test(s)); assert.ok(!s.includes(f.secret) && !s.includes(f.apiKey));
});
test('a failing event write does not break ingestion', async () => {
  const f = fixture(); f.repo.createEvent = async () => { throw new Error('db down'); };
  const r = await processTelemetry({ ...f.deps, log: () => {} }, f.send({}, { badSig: true })); assert.equal(r.httpStatus, 401);
});

test('readings from a SUSPICIOUS sensor are held for review even when they look normal', async () => {
  const f = fixture(); f.repo.sensors.get('WS-001')!.status = 'SUSPICIOUS';
  const r = await processTelemetry(f.deps, f.send());
  assert.equal(r.body.decision, 'FLAG'); assert.equal(f.fwd.forwarded.length, 0); assert.deepEqual(types(f), ['SENSOR_FLAGGED']);
});
test('sequence numbers beyond the database INTEGER range are rejected as malformed', async () => {
  const f = fixture(); const r = await processTelemetry(f.deps, f.send({}, { seq: 2_147_483_648 }));
  assert.equal(r.httpStatus, 400); assert.equal(f.repo.claimed.size, 0);
});
