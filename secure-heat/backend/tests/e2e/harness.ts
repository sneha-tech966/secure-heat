/** E2E harness: the REAL ingestion pipeline + REAL HttpMlClient behind a plain node:http server, with an in-memory repo.
 *  Only the database is faked. Usage: tsx tests/e2e/harness.ts <credentials.json> <port> <ml-url> */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { processTelemetry } from '../../src/services/ingestPipeline.js';
import { HttpMlClient } from '../../src/services/mlClient.js';
import { encryptSecret, hashApiKey } from '../../src/utils/crypto.js';
import { CONFIG, ENC_KEY, FakeForwarder, FakeRepo } from '../helpers.js';

const [credPath = '', port = '4000', mlUrl = 'http://127.0.0.1:8000'] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credPath, 'utf8')) as Record<string, { apiKey: string; secret: string }>;
const repo = new FakeRepo(), fwd = new FakeForwarder();
for (const [id, c] of Object.entries(creds)) repo.sensors.set(id, { id, sensorId: id, status: 'ACTIVE', apiKeyHash: hashApiKey(c.apiKey), secretKeyEnc: encryptSecret(c.secret, ENC_KEY) });
const deps = { repo, forwarder: fwd, ml: new HttpMlClient({ baseUrl: mlUrl, timeoutMs: 3000 }), config: CONFIG, log: (m: string) => console.error(m) };

createServer((req, res) => {
  const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/__state') {
      const tel = repo.telemetry.map((t) => ({ id: t.id, sensorId: t.sensorId, decision: t.decision, status: t.processingStatus, score: t.anomalyScore, seq: t.sequenceNumber }));
      return send(200, { telemetry: tel, events: repo.events.map((e) => ({ type: e.eventType, severity: e.severity, sensorId: e.sensorId, description: e.description })), forwarded: fwd.forwarded });
    }
    if (req.method === 'POST' && req.url === '/api/telemetry/ingest') {
      const rawBody = Buffer.concat(chunks); let body: unknown = null; try { body = JSON.parse(rawBody.toString()); } catch { /* handled by pipeline */ }
      const r = await processTelemetry(deps, { apiKey: req.headers['x-api-key'] as string | undefined, signature: req.headers['x-signature'] as string | undefined, rawBody, body, sourceIP: req.socket.remoteAddress ?? 'unknown' });
      return send(r.httpStatus, r.body);
    }
    send(404, { error: 'not found' });
  });
}).listen(Number(port), '127.0.0.1', () => console.error(`harness listening on ${port}`));
