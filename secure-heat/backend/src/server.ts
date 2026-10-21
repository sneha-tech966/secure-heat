import { loadConfig } from './config/env.js';
import { createApp } from './app.js';
import { createPrisma } from './db.js';
import { HttpForwarder, NoopForwarder } from './services/forwarder.js';
import { HttpMlClient } from './services/mlClient.js';
import { PrismaIngestRepo } from './services/prismaRepo.js';

const config = loadConfig();                 // throws on weak/missing secrets
const db = createPrisma();
const repo = new PrismaIngestRepo(db);
const ingest = {
  repo, config,
  ml: new HttpMlClient({ baseUrl: config.mlServiceUrl, timeoutMs: config.mlTimeoutMs, token: config.mlInternalToken }),
  forwarder: config.forecastingUrl ? new HttpForwarder(config.forecastingUrl, config.forecastingToken) : new NoopForwarder(),
  log: (m: string, e?: unknown) => console.error(m, e instanceof Error ? e.message : ''),
};

const app = createApp(db, config, ingest);
const server = app.listen(config.port, () => console.log(`Secure-Heat backend listening on :${config.port} (${config.nodeEnv})`));

// replay records older than 2x the timestamp window can never be replayed (stale timestamps are rejected first)
const purge = setInterval(() => { repo.purgeReplayRecords(new Date(Date.now() - 2 * config.timestampWindowSeconds * 1000)).catch((e) => console.error('purge failed', e instanceof Error ? e.message : e)); }, 10 * 60_000);
purge.unref();

const shutdown = () => { clearInterval(purge); server.close(() => { db.$disconnect().finally(() => process.exit(0)); }); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
