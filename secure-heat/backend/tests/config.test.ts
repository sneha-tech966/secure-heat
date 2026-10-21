import test from 'node:test'; import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/env.js';
import { PERMISSIONS, can } from '../src/config/permissions.js';

const base = { JWT_SECRET: 'x'.repeat(40), SENSOR_SECRET_ENC_KEY: Buffer.alloc(32, 1).toString('base64') };

test('valid config loads with safe defaults', () => {
  const c = loadConfig(base); assert.equal(c.mlFailMode, 'quarantine'); assert.equal(c.timestampWindowSeconds, 120); assert.equal(c.sensorSecretEncKey.length, 32);
});
test('fails fast on missing/weak secrets and bad keys', () => {
  assert.throws(() => loadConfig({ ...base, JWT_SECRET: 'short' })); assert.throws(() => loadConfig({ ...base, JWT_SECRET: undefined }));
  assert.throws(() => loadConfig({ ...base, SENSOR_SECRET_ENC_KEY: 'abc' }));
});
test('ML_FAIL_MODE has no pass-through option', () => {
  assert.throws(() => loadConfig({ ...base, ML_FAIL_MODE: 'accept' }), /ML_FAIL_MODE/); assert.equal(loadConfig({ ...base, ML_FAIL_MODE: 'reject' }).mlFailMode, 'reject');
});
test('threshold validation', () => {
  assert.throws(() => loadConfig({ ...base, FLAG_THRESHOLD: '0.9995', QUARANTINE_THRESHOLD: '0.99' })); assert.throws(() => loadConfig({ ...base, FLAG_THRESHOLD: '2' }));
  assert.equal(loadConfig({ ...base, FLAG_THRESHOLD: '0.95' }).flagThreshold, 0.95);
});
test('RBAC matrix: viewer is read-only; only admin manages users/sensors/credentials; analysts review quarantine', () => {
  for (const p of ['manageUsers', 'registerSensor', 'rotateCredentials', 'changeSensorStatus', 'resolveEvent', 'manageSettings'] as const) { assert.ok(can('ADMIN', p)); assert.ok(!can('VIEWER', p)); assert.ok(!can('SECURITY_ANALYST', p)); }
  assert.ok(can('SECURITY_ANALYST', 'reviewQuarantine')); assert.ok(!can('VIEWER', 'reviewQuarantine')); assert.ok(!can('VIEWER', 'investigateEvent'));
  for (const p of ['viewSensors', 'viewTelemetry', 'viewEvents'] as const) assert.ok(can('VIEWER', p));
  assert.ok(!can('VIEWER', 'viewMlAnalytics')); assert.ok(Object.keys(PERMISSIONS).length > 10);
});
