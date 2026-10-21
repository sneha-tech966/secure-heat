import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { audit } from '../services/audit.js';
import { HttpError } from '../utils/errors.js';
import { simScenarioBody } from '../validators/query.js';

/** Authenticated, role-checked proxy to the simulator's control API (the browser never talks to the simulator directly). */
export function simulatorController(db: PrismaClient, config: AppConfig) {
  async function call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    if (!config.simulatorUrl) throw new HttpError(503, 'simulator is not configured (set SIMULATOR_URL and SIMULATOR_TOKEN)', 'NOT_CONFIGURED');
    let r: globalThis.Response;
    try {
      r = await fetch(config.simulatorUrl + path, { method, signal: AbortSignal.timeout(5000), body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(config.simulatorToken ? { 'x-control-token': config.simulatorToken } : {}) } });
    } catch { throw new HttpError(503, 'simulator is not running or unreachable. Start it with: python simulator.py serve --control-port 5055', 'SIMULATOR_DOWN'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(r.status === 400 ? 400 : 502, (j as { error?: string }).error ?? 'simulator error', 'SIMULATOR_ERROR');
    return j;
  }
  return {
    status: async (_q: Request, res: Response) => res.json(await call('/status', 'GET')),
    log: async (req: Request, res: Response) => res.json(await call(`/log?limit=${Math.min(Number(req.query.limit) || 100, 500)}`, 'GET')),
    async start(req: Request, res: Response) { const s = await call('/start', 'POST', {}); await audit(db, req, { action: 'SIMULATOR_STARTED', targetType: 'Simulator' }); res.json(s); },
    async stop(req: Request, res: Response) { const s = await call('/stop', 'POST', {}); await audit(db, req, { action: 'SIMULATOR_STOPPED', targetType: 'Simulator' }); res.json(s); },
    async scenario(req: Request, res: Response) {
      const b = simScenarioBody.parse(req.body); const s = await call('/scenario', 'POST', b);
      await audit(db, req, { action: 'SIMULATOR_SCENARIO', targetType: 'Simulator', details: { scenario: b.scenario, target: b.target ?? 'all', ticks: b.ticks, rate: b.rate } }); res.json(s);
    },
  };
}
