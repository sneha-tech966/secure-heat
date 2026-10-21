import test from 'node:test'; import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http'; import type { AddressInfo } from 'node:net';
import { HttpMlClient, parseMlResponse } from '../src/services/mlClient.js';
import { MlUnavailableError } from '../src/services/ports.js';

const R = { temperature: 22, humidity: 60, pressure: 1012, windSpeed: 4, windDirection: 180, rainfall: 0, solarRadiation: 300 };
const good = { anomaly_score: 0.5, raw_score: 0.5, prediction: 'NORMAL', ml_severity: 'NONE', rules_triggered: [], rule_details: [], hard_rule_violation: false, explanation: 'ok' };

function stub(handler: (req: any, body: any, res: any) => void): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => handler(req, b ? JSON.parse(b) : null, res)); });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

test('maps request fields to snake_case, sends internal token, parses response', async () => {
  let seen: any, hdr: any;
  const { server, url } = await stub((req, body, res) => { seen = body; hdr = req.headers['x-internal-token']; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(good)); });
  try { const r = await new HttpMlClient({ baseUrl: url, timeoutMs: 1000, token: 'tok' }).predict('WS-001', R, '2026-10-16T10:00:00Z');
    assert.equal(seen.wind_speed, 4); assert.equal(seen.solar_radiation, 300); assert.equal(seen.sensor_id, 'WS-001'); assert.equal(hdr, 'tok'); assert.equal(r.anomalyScore, 0.5);
  } finally { server.close(); }
});
test('non-2xx, timeout, malformed body and connection refused all become MlUnavailableError', async () => {
  const s503 = await stub((_q, _b, res) => { res.statusCode = 503; res.end('{"detail":"model_not_loaded"}'); });
  const slow = await stub(() => { /* never answers */ });
  const bad = await stub((_q, _b, res) => { res.setHeader('content-type', 'application/json'); res.end('{"anomaly_score": 7}'); });
  try {
    for (const [u, t] of [[s503.url, 500], [slow.url, 150], [bad.url, 500], ['http://127.0.0.1:1', 500]] as const)
      await assert.rejects(new HttpMlClient({ baseUrl: u, timeoutMs: t }).predict('WS-001', R, 't'), MlUnavailableError);
  } finally { s503.server.close(); bad.server.close(); slow.server.closeAllConnections(); slow.server.close(); }
});
test('response validation rejects out-of-range scores and wrong types', () => {
  assert.throws(() => parseMlResponse({ ...good, anomaly_score: 1.5 }), MlUnavailableError);
  assert.throws(() => parseMlResponse({ ...good, prediction: 'MAYBE' }), MlUnavailableError);
  assert.throws(() => parseMlResponse(null), MlUnavailableError);
  assert.equal(parseMlResponse({ ...good, rule_details: [{ rule: 'X', category: 'range', severity: 'HIGH', hard: true, message: 'm' }] }).hardRuleViolation, true);
});
