import test from 'node:test'; import assert from 'node:assert/strict';
import { eventQuery, telemetryQuery, quarantineQuery, reviewBody, resolveBody, simScenarioBody, trendsQuery } from '../src/validators/query.js';
import { createUserSchema, loginSchema, markSuspiciousSchema, registerSensorSchema, sensorStatusSchema, updateUserSchema } from '../src/validators/schemas.js';
import { eventWhere, pageArgs, quarantineWhere, telemetryOrder, telemetryWhere } from '../src/services/queries.js';
import { nextEventStatus, reviewGuard } from '../src/services/workflow.js';
import { baselineForecast } from '../src/services/forecast.js';
import { histogram } from '../src/services/analytics.js';

test('query defaults, coercion and bounds', () => {
  const q = telemetryQuery.parse({}); assert.deepEqual([q.page, q.pageSize, q.sortBy, q.order], [1, 25, 'timestamp', 'desc']);
  assert.equal(telemetryQuery.parse({ page: '3', pageSize: '50' }).page, 3);
  assert.throws(() => telemetryQuery.parse({ pageSize: '5000' })); assert.throws(() => telemetryQuery.parse({ page: '0' }));
});
test('sort keys are whitelisted and unknown/injected parameters are rejected', () => {
  assert.throws(() => telemetryQuery.parse({ sortBy: 'password; DROP TABLE' })); assert.throws(() => telemetryQuery.parse({ sortBy: 'apiKeyHash' }));
  assert.throws(() => telemetryQuery.parse({ where: '1=1' })); assert.throws(() => eventQuery.parse({ sensorId: "x' OR '1'='1" }));
});
test('date range and enum validation', () => {
  assert.throws(() => telemetryQuery.parse({ from: 'not-a-date' })); assert.throws(() => telemetryQuery.parse({ from: '2026-10-02', to: '2026-10-01' }));
  const q = telemetryQuery.parse({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' }); assert.ok(q.from instanceof Date);
  assert.throws(() => eventQuery.parse({ severity: 'EXTREME' })); assert.throws(() => quarantineQuery.parse({ state: 'all' }));
  assert.equal(trendsQuery.parse({}).hours, 24); assert.throws(() => trendsQuery.parse({ hours: '9999' }));
});
test('where/order/page builders only include provided filters', () => {
  assert.deepEqual(telemetryWhere({}), {});
  const w: any = telemetryWhere({ sensorId: 'WS-001', decision: 'FLAG', from: new Date(0), to: new Date(5) });
  assert.equal(w.sensorId, 'WS-001'); assert.equal(w.decision, 'FLAG'); assert.deepEqual(Object.keys(w.timestamp), ['gte', 'lte']);
  assert.deepEqual((telemetryWhere({ q: 'ws-0' }) as any).sensorId, { contains: 'ws-0', mode: 'insensitive' });
  assert.deepEqual(eventWhere({ severity: 'HIGH' }), { severity: 'HIGH' });
  assert.deepEqual(pageArgs({ page: 3, pageSize: 25 }), { skip: 50, take: 25 }); assert.deepEqual(telemetryOrder('humidity', 'asc')[0], { humidity: 'asc' });
});
test('quarantine states map to disjoint record sets; pending is only QUARANTINED', () => {
  assert.equal((quarantineWhere('pending') as any).processingStatus, 'QUARANTINED');
  assert.equal((quarantineWhere('approved') as any).processingStatus, 'FORWARDED'); assert.equal((quarantineWhere('rejected', 'WS-2') as any).sensorId, 'WS-2');
});
test('review/resolve bodies require a reason; sim scenario is validated', () => {
  assert.throws(() => reviewBody.parse({ notes: '' })); assert.throws(() => reviewBody.parse({})); assert.ok(reviewBody.parse({ notes: 'checked against neighbour sensor' }));
  assert.throws(() => resolveBody.parse({ resolutionNotes: ' ' }));
  assert.throws(() => simScenarioBody.parse({ scenario: 'rm -rf' })); assert.throws(() => simScenarioBody.parse({ scenario: 'normal', rate: 5 })); assert.equal(simScenarioBody.parse({ scenario: 'wind_spike' }).rate, 1);
});
test('auth/user/sensor schemas: strict, password policy, role enum', () => {
  assert.throws(() => createUserSchema.parse({ name: 'a', email: 'a@b.co', password: 'short', role: 'ADMIN' }));
  assert.throws(() => createUserSchema.parse({ name: 'a', email: 'a@b.co', password: 'long-enough-password', role: 'ROOT' }));
  assert.throws(() => createUserSchema.parse({ name: 'a', email: 'a@b.co', password: 'long-enough-password', role: 'VIEWER', isAdmin: true }));
  assert.ok(createUserSchema.parse({ name: 'a', email: 'a@b.co', password: 'long-enough-password', role: 'VIEWER' }));
  assert.throws(() => updateUserSchema.parse({})); assert.throws(() => loginSchema.parse({ email: 'nope', password: 'x' }));
  assert.throws(() => registerSensorSchema.parse({ sensorId: 'bad id!', name: 'n', location: 'l' })); assert.throws(() => registerSensorSchema.parse({ sensorId: 'WS-9', name: 'n', location: 'l', latitude: 200 }));
  assert.throws(() => sensorStatusSchema.parse({ status: 'SUSPICIOUS' })); assert.throws(() => markSuspiciousSchema.parse({ reason: '' }));
});
test('incident lifecycle: investigate only from OPEN; resolve from OPEN/INVESTIGATING; RESOLVED is terminal', () => {
  assert.equal(nextEventStatus('OPEN', 'investigate'), 'INVESTIGATING'); assert.equal(nextEventStatus('INVESTIGATING', 'investigate'), null);
  assert.equal(nextEventStatus('OPEN', 'resolve'), 'RESOLVED'); assert.equal(nextEventStatus('INVESTIGATING', 'resolve'), 'RESOLVED');
  assert.equal(nextEventStatus('RESOLVED', 'resolve'), null); assert.equal(nextEventStatus('RESOLVED', 'investigate'), null);
});
test('quarantine review guard: pending only, impossible values and blocked sensors can never be approved', () => {
  const ok = { processingStatus: 'QUARANTINED', rulesTriggered: [] }; const hard = { processingStatus: 'QUARANTINED', rulesTriggered: [{ rule: 'HUMIDITY_OUT_OF_RANGE', category: 'range', severity: 'HIGH', hard: true, message: 'm' }] };
  assert.deepEqual(reviewGuard(ok, 'ACTIVE', 'approve'), { ok: true }); assert.deepEqual(reviewGuard(ok, 'SUSPICIOUS', 'approve'), { ok: true });
  const g1: any = reviewGuard(hard, 'ACTIVE', 'approve'); assert.equal(g1.code, 'IMPOSSIBLE_VALUE'); assert.deepEqual(reviewGuard(hard, 'ACTIVE', 'reject'), { ok: true });
  assert.equal((reviewGuard(ok, 'BLOCKED', 'approve') as any).code, 'SENSOR_BLOCKED');
  for (const s of ['FORWARDED', 'REJECTED', 'AUTHENTICATED']) assert.equal((reviewGuard({ processingStatus: s, rulesTriggered: [] }, 'ACTIVE', 'approve') as any).code, 'NOT_PENDING');
});
test('baseline forecast: extrapolates a trend, flat series stays flat, too little data yields nothing', () => {
  const up = baselineForecast(Array.from({ length: 24 }, (_, i) => 10 + i * 0.5), 6); assert.equal(up.points.length, 6);
  assert.ok(up.points[0]!.value > 21.5 && up.points[5]!.value > up.points[0]!.value); assert.ok(up.points[5]!.value < 10 + 29 * 0.5 + 3 /* damped, not runaway */);
  const flat = baselineForecast(Array(12).fill(20), 3); assert.ok(flat.points.every((p) => Math.abs(p.value - 20) < 1e-6 && p.lower <= p.value && p.upper >= p.value));
  assert.equal(baselineForecast([1, 2, 3], 6).points.length, 0); assert.equal(baselineForecast([1, 2, 3, 4, 5], 0).points.length, 0);
  assert.equal(baselineForecast([NaN, 1, 2, 3, 4, 5], 2).basedOn, 5);
});
test('histogram: bin edges, inclusive top, ignores invalid values', () => {
  const h = histogram([0, 0.05, 0.1, 0.99, 1, 1.2, -0.1, NaN], 10); assert.equal(h[0]!.count, 2); assert.equal(h[1]!.count, 1); assert.equal(h[9]!.count, 2);
  assert.equal(h.reduce((a, b) => a + b.count, 0), 5); assert.equal(h.length, 10);
});
