import test from 'node:test'; import assert from 'node:assert/strict';
import { checkRanges, parseAuthFields, parseTelemetry } from '../src/validators/telemetry.js';
import { CONFIG } from './helpers.js';

const ok = { sensorId: 'WS-001', timestamp: '2026-10-16T10:00:00Z', sequenceNumber: 1, temperature: 22, humidity: 60, pressure: 1012, windSpeed: 4, windDirection: 180, rainfall: 0, solarRadiation: 300 };

test('valid payload parses', () => { const r = parseTelemetry(ok); assert.ok(r.ok); if (r.ok) assert.equal(r.value.reading.humidity, 60); });
test('rejects missing / non-numeric / non-finite fields', () => {
  assert.ok(!parseTelemetry({ ...ok, humidity: undefined }).ok);
  assert.ok(!parseTelemetry({ ...ok, humidity: '60' }).ok);
  assert.ok(!parseTelemetry({ ...ok, humidity: null }).ok);
  assert.ok(!parseTelemetry({ ...ok, humidity: Infinity }).ok);
  assert.ok(!parseTelemetry({ ...ok, humidity: NaN }).ok);
});
test('rejects client-supplied anomaly scores and any unknown field', () => {
  const r = parseTelemetry({ ...ok, anomalyScore: 0 }); assert.ok(!r.ok); if (!r.ok) assert.match(r.error, /anomalyScore/);
  assert.ok(!parseTelemetry({ ...ok, signature: 'x' }).ok);
});
test('timestamp / sequence / sensor id validation', () => {
  assert.ok(!parseAuthFields({ ...ok, timestamp: '2026-10-16 10:00:00' }).ok);       // no timezone
  assert.ok(!parseAuthFields({ ...ok, timestamp: 'yesterday' }).ok);
  assert.ok(!parseAuthFields({ ...ok, sequenceNumber: -1 }).ok);
  assert.ok(!parseAuthFields({ ...ok, sequenceNumber: 1.5 }).ok);
  assert.ok(!parseAuthFields({ ...ok, sequenceNumber: '1' }).ok);
  assert.ok(!parseAuthFields({ ...ok, sensorId: "WS-001'; DROP TABLE" }).ok);
  assert.ok(!parseAuthFields([1, 2]).ok); assert.ok(!parseAuthFields(null).ok);
});
test('range check flags impossible physical values as hard violations', () => {
  const r = parseTelemetry({ ...ok, humidity: 150, windSpeed: -2 }); assert.ok(r.ok);
  if (r.ok) { const v = checkRanges(r.value.reading, CONFIG.limits); assert.deepEqual(v.map((x) => x.rule).sort(), ['HUMIDITY_OUT_OF_RANGE', 'WIND_SPEED_OUT_OF_RANGE']); assert.ok(v.every((x) => x.hard)); }
});
