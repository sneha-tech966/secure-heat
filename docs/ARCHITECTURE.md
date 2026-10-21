# Secure-Heat — Phase 1 Architecture Proposal

## 1. Repository / environment inspection

| Item | Finding |
|---|---|
| Existing repo | None. Empty workspace; scaffold created fresh (nothing overwritten). |
| Node | v22 available |
| Python | 3.12; scikit-learn 1.8, pandas, numpy, joblib, requests present |
| Missing here | FastAPI, uvicorn, pydantic, pytest, httpx; Docker; PostgreSQL |
| Network | Package registries blocked (npm returned 403) |

**Consequence:** in this sandbox I can write all code and run the pure-Python parts (dataset generation, Isolation Forest training/evaluation, rule engine, HMAC logic). I cannot install npm/pip packages, run PostgreSQL/Docker, or execute Prisma migrations, the React build, or the FastAPI server. Those pieces will be written carefully but must be verified on your machine, and I will not claim they were tested here.

## 2. Services and trust boundaries

```
 Sensor Simulator ──HTTPS+HMAC──▶ Backend (Express)  ◀──JWT cookie── React SPA
                                     │   │
                          Prisma     │   └──HTTP──▶ ML Service (FastAPI)
                                     ▼
                                PostgreSQL
```

- **Backend** is the only component that touches the DB and the only one that decides ACCEPT/FLAG/QUARANTINE/REJECT. Client-supplied scores are ignored.
- **ML service** is stateless inference: loads a trained `.joblib` at startup, returns score + rules + explanation.
- **Frontend** holds no secrets; all authorization is enforced by backend middleware.

## 3. Ingestion pipeline (order matters)

1. Parse envelope (`sensorId`, `timestamp`, `sequenceNumber`, `signature`, payload)
2. Look up sensor; reject if missing/BLOCKED/INACTIVE
3. Verify API key (bcrypt/argon hash compare) → else `AUTH_FAILURE`
4. Verify HMAC-SHA256 over canonical JSON (sorted keys) incl. sensorId, timestamp, sequence → constant-time compare → else `INVALID_SIGNATURE`
5. Timestamp window check → else `REPLAY_ATTACK`/stale
6. Atomic replay insert: `ReplayRecord` with `@@unique([sensorId, sequenceNumber])`; unique-violation ⇒ `REPLAY_ATTACK`
7. Zod payload validation → else `INVALID_TELEMETRY` (REJECT)
8. Backend rule checks, then ML call (timeout)
9. Decision engine → persist Telemetry (`processingStatus`)
10. FORWARDED only for ACCEPT (and FLAG per config); QUARANTINED rows never enter the trusted view
11. SecurityEvent written with distinct `eventType` per failure class

Key design choices:
- **Order**: signature is verified *before* replay insert so unauthenticated callers cannot poison sequence numbers.
- **Sensor secret storage**: HMAC needs the raw secret, so it cannot be hashed. Store it encrypted at rest (AES-256-GCM using `SENSOR_SECRET_ENC_KEY`); API keys are hashed. Neither is returned by any API; raw credentials are shown once at registration/rotation.
- **ML outage**: `ML_FAIL_MODE` is `quarantine` (default) or `reject`. There is deliberately no pass-through option.
- **Natural vs malicious**: events carry `eventType` separating crypto/auth failures from statistical anomalies; ML-only anomalies are labelled "needs review", not "attack".
- **Trusted view**: `GET /api/trusted-telemetry` queries `processingStatus = FORWARDED` only.

## 4. Data model (as specified, plus)

- Add `AuditLog` (actor, action, target, before/after, ip, at) for incident updates, quarantine approvals, credential rotation.
- Add `Telemetry.decision`, `rulesTriggered Json`, `explanation String`, `sequenceNumber`.
- Indexes: `Telemetry(sensorId, timestamp)`, `Telemetry(processingStatus)`, `SecurityEvent(severity, detectedAt)`.
- Enums for roles, statuses, severities, event types.

## 5. ML design

- Synthetic dataset (clearly labelled) with diurnal temperature, anti-correlated humidity, pressure drift, gust-driven wind, daylight-gated solar radiation, per-sensor offsets; labelled injections for the 8 anomaly types.
- Features: raw values + rolling deltas + per-sensor z-deviation.
- Isolation Forest trained on normal-only windows; score normalized via training-score percentiles (reported as an *anomaly score*, not a probability).
- Evaluation on held-out labelled data → precision/recall/F1/confusion matrix → `ModelMetrics`.
- Feature contribution: permutation-based importance with documented limitations.

## 6. API surface (summary)

`/api/auth/*`, `/api/users/*` (ADMIN), `/api/sensors/*`, `/api/telemetry/ingest`, `/api/telemetry`, `/api/trusted-telemetry`, `/api/events/*`, `/api/quarantine/*`, `/api/analytics/*`, `/api/simulator/*`, `/api/settings`. ML: `/predict`, `/train`, `/health`, `/metrics`.

RBAC matrix is enforced by a `requireRole(...)` middleware on each route; frontend only hides UI.

## 7. Simulator

Python process (5 stations) using the real ingest API with HMAC signing. Scenarios: normal, temperature spoof, humidity manipulation, replay, wind spike, drift. Start/stop is controlled via backend endpoints that spawn/stop the simulator process (admin/analyst only); the live view reads from the normal telemetry endpoints.

## 8. Build order given the environment

Because package installs are blocked here, I propose building in this order, verifying what can be verified:

1. **ML pipeline first** (Phases 6–7a): dataset → train → evaluate → rule engine, with real metrics and pytest-style tests runnable here.
2. **Backend** (Phases 3–5, 8, 11): code + Prisma schema + tests written in full; verified only by type-check where possible.
3. **Simulator** (Phase 9).
4. **Frontend** (Phase 10, 12).
5. **Docker/README** (Phase 14) — verified by you via `docker compose up`.

## 9. Open decisions

- FLAG behaviour: forward flagged readings to forecasting, or hold for review? (Default proposed: hold FLAG out of the trusted view until reviewed.)
- Token transport: httpOnly cookie (proposed) vs. bearer header.
- Password hashing: bcrypt as specified.
