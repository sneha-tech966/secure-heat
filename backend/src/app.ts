import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { buildRouter } from './routes/index.js';
import type { IngestDeps } from './services/ingestPipeline.js';

export function createApp(db: PrismaClient, config: AppConfig, ingest: IngestDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'x-requested-with', 'x-api-key', 'x-signature'] }));
  app.use(globalLimiter(config));
  // rawBody is captured because sensor signatures cover the exact bytes that were sent
  app.use(express.json({ limit: '16kb', verify: (req, _res, buf) => { (req as express.Request).rawBody = buf; } }));
  app.use(cookieParser());
  app.use('/api', buildRouter(db, config, ingest));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
