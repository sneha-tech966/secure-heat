import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import { PERMISSIONS } from '../config/permissions.js';
import { authController } from '../controllers/authController.js';
import { dataController } from '../controllers/dataController.js';
import { eventController } from '../controllers/eventController.js';
import { quarantineController } from '../controllers/quarantineController.js';
import { sensorController } from '../controllers/sensorController.js';
import { simulatorController } from '../controllers/simulatorController.js';
import { statsController } from '../controllers/statsController.js';
import { ingestHandler } from '../controllers/telemetryController.js';
import { userController } from '../controllers/userController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { csrfGuard } from '../middleware/csrf.js';
import { ingestLimiter, loginLimiter } from '../middleware/rateLimit.js';
import type { IngestDeps } from '../services/ingestPipeline.js';
import { asyncHandler } from '../utils/errors.js';

export function buildRouter(db: PrismaClient, config: AppConfig, ingest: IngestDeps): Router {
  const api = Router(); const P = PERMISSIONS;
  const a = authController(db, config), u = userController(db), s = sensorController(db, config), d = dataController(db), ev = eventController(db),
    q = quarantineController(db, ingest.forwarder), st = statsController(db, config), sim = simulatorController(db, config);
  const auth = authenticate(db, config), csrf = csrfGuard(config);
  const h = (fn: (req: any, res: any) => unknown) => asyncHandler(async (req, res) => { await fn(req, res); });

  api.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  // Sensor ingestion: API key + HMAC auth (not cookies), so no session auth / CSRF guard here.
  api.post('/telemetry/ingest', ingestLimiter(config), asyncHandler(ingestHandler(ingest)));

  // Everything below uses cookie sessions -> CSRF guard on state-changing requests.
  api.use(csrf);
  api.post('/auth/login', loginLimiter(config), h(a.login)); api.post('/auth/logout', (req, res) => a.logout(req, res));
  api.post('/auth/forgot-password', loginLimiter(config), (req, res) => a.forgotPassword(req, res)); api.get('/auth/me', auth, (req, res) => a.me(req, res));

  api.get('/users', auth, requireRole(...P.manageUsers), h(u.list)); api.post('/users', auth, requireRole(...P.manageUsers), h(u.create));
  api.patch('/users/:id', auth, requireRole(...P.manageUsers), h(u.update)); api.delete('/users/:id', auth, requireRole(...P.manageUsers), h(u.remove));

  api.get('/sensors', auth, requireRole(...P.viewSensors), h(s.list)); api.post('/sensors', auth, requireRole(...P.registerSensor), h(s.register));
  api.get('/sensors/:sensorId', auth, requireRole(...P.viewSensors), h(s.detail));
  api.patch('/sensors/:sensorId/status', auth, requireRole(...P.changeSensorStatus), h(s.setStatus));
  api.post('/sensors/:sensorId/rotate-credentials', auth, requireRole(...P.rotateCredentials), h(s.rotate));
  api.post('/sensors/:sensorId/mark-suspicious', auth, requireRole(...P.markSensorSuspicious), h(s.markSuspicious));

  api.get('/telemetry', auth, requireRole(...P.viewTelemetry), h(d.list)); api.get('/telemetry/:id', auth, requireRole(...P.viewTelemetry), h(d.detail));
  api.get('/trusted-telemetry', auth, requireRole(...P.viewTelemetry), h(d.trusted)); api.get('/forecast/trends', auth, requireRole(...P.viewTelemetry), h(d.trends));

  api.get('/events', auth, requireRole(...P.viewEvents), h(ev.list)); api.get('/events/:id', auth, requireRole(...P.viewEvents), h(ev.detail));
  api.post('/events/:id/investigate', auth, requireRole(...P.investigateEvent), h(ev.investigate));
  api.post('/events/:id/notes', auth, requireRole(...P.investigateEvent), h(ev.addNote));
  api.post('/events/:id/resolve', auth, requireRole(...P.resolveEvent), h(ev.resolve));

  api.get('/quarantine', auth, requireRole(...P.reviewQuarantine), h(q.list));
  api.post('/quarantine/:id/approve', auth, requireRole(...P.reviewQuarantine), h(q.approve));
  api.post('/quarantine/:id/reject', auth, requireRole(...P.reviewQuarantine), h(q.reject));

  api.get('/stats/overview', auth, requireRole(...P.viewDashboard), h(st.overview));
  api.get('/analytics/model', auth, requireRole(...P.viewMlAnalytics), h(st.model));
  api.post('/analytics/model/refresh', auth, requireRole(...P.manageModel), h(st.refreshModel));
  api.post('/analytics/model/train', auth, requireRole(...P.manageModel), h(st.trainModel));
  api.get('/settings', auth, requireRole(...P.manageSettings), (req, res) => st.settings(req, res));
  api.get('/audit', auth, requireRole(...P.manageSettings), h(st.audit));

  api.get('/simulator/status', auth, requireRole(...P.controlSimulator), h(sim.status)); api.get('/simulator/log', auth, requireRole(...P.controlSimulator), h(sim.log));
  api.post('/simulator/start', auth, requireRole(...P.controlSimulator), h(sim.start)); api.post('/simulator/stop', auth, requireRole(...P.controlSimulator), h(sim.stop));
  api.post('/simulator/scenario', auth, requireRole(...P.controlSimulator), h(sim.scenario));
  return api;
}
