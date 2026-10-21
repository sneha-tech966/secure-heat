import type { Request, Response } from 'express';
import { processTelemetry, type IngestDeps } from '../services/ingestPipeline.js';

const hdr = (req: Request, name: string) => { const v = req.get(name); return v && v.length <= 512 ? v : undefined; };

export const ingestHandler = (deps: IngestDeps) => async (req: Request, res: Response) => {
  const result = await processTelemetry(deps, { apiKey: hdr(req, 'x-api-key'), signature: hdr(req, 'x-signature'),
    rawBody: req.rawBody ?? Buffer.alloc(0), body: req.body, sourceIP: req.ip ?? 'unknown' });
  res.status(result.httpStatus).json(result.body);
};
