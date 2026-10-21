import test from 'node:test'; import assert from 'node:assert/strict';
import { canonicalString, decryptSecret, encryptSecret, generateApiKey, generateSecret, hashApiKey, safeEqualHex, signCanonical, verifyApiKey, verifySignature } from '../src/utils/crypto.js';

test('HMAC matches an independently computed Python reference vector (sensor simulator compatibility)', () => {
  const body = '{"sensorId":"WS-001","timestamp":"2026-10-16T10:00:00Z","sequenceNumber":42,"temperature":21.5}';
  const canon = canonicalString('WS-001', '2026-10-16T10:00:00Z', 42, body);
  assert.equal(canon.split('\n')[4], '47e2c9ffa751b0370a854bc836f2a6895a954e40e2947a7821f885e499d2d69a');
  assert.equal(signCanonical('ab'.repeat(32), canon), 'd3619991337a5f818d5122240b7bafa96a23eb1f2734a60643358a72928ed202');
});
test('signature verifies; tampering with any signed element fails', () => {
  const s = generateSecret(), body = '{"a":1}', sig = signCanonical(s, canonicalString('WS-1', 't', 1, body));
  assert.ok(verifySignature(s, canonicalString('WS-1', 't', 1, body), sig));
  assert.ok(!verifySignature(s, canonicalString('WS-1', 't', 2, body), sig));       // sequence
  assert.ok(!verifySignature(s, canonicalString('WS-1', 't2', 1, body), sig));      // timestamp
  assert.ok(!verifySignature(s, canonicalString('WS-2', 't', 1, body), sig));       // sensor
  assert.ok(!verifySignature(s, canonicalString('WS-1', 't', 1, '{"a":2}'), sig));  // body
  assert.ok(!verifySignature(generateSecret(), canonicalString('WS-1', 't', 1, body), sig)); // key
});
test('malformed signatures are rejected without throwing', () => {
  for (const bad of ['', 'zz', 'abcd', 'g'.repeat(64), 'a'.repeat(63)]) assert.equal(verifySignature('k', 'c', bad), false);
  assert.equal(safeEqualHex('ab', 'abc'), false);
});
test('api keys: only hash is checked, wrong key fails', () => {
  const k = generateApiKey(), h = hashApiKey(k);
  assert.ok(k.startsWith('sh_') && h.length === 64 && !h.includes(k));
  assert.ok(verifyApiKey(k, h)); assert.ok(!verifyApiKey(k + 'x', h)); assert.ok(!verifyApiKey('', h));
});
test('secret encryption round-trips, is randomized, and detects tampering/wrong key', () => {
  const key = Buffer.alloc(32, 1), s = generateSecret(), a = encryptSecret(s, key), b = encryptSecret(s, key);
  assert.notEqual(a, b); assert.equal(decryptSecret(a, key), s); assert.ok(!a.includes(s));
  assert.throws(() => decryptSecret(a, Buffer.alloc(32, 2)));
  const parts = a.split(':'); parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptSecret(parts.join(':'), key));
});
