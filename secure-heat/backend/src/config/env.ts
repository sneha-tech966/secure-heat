import type { ReadingField } from '../types.js';

export interface AppConfig {
  nodeEnv: string; port: number; corsOrigin: string[]; trustProxy: boolean;
  jwtSecret: string; jwtExpiresSeconds: number; cookieSecure: boolean;
  rateLimitWindowMs: number; rateLimitMax: number; authRateLimitMax: number; ingestRateLimitMax: number;
  sensorSecretEncKey: Buffer;
  timestampWindowSeconds: number;
  mlServiceUrl: string; mlTimeoutMs: number; mlInternalToken: string;
  mlFailMode: 'quarantine' | 'reject';
  rangeViolationAction: 'quarantine' | 'reject';
  flagThreshold: number; quarantineThreshold: number;
  forecastingUrl: string | null; forecastingToken: string;
  simulatorUrl: string | null; simulatorToken: string;
  limits: Record<ReadingField, [number, number]>;
}

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, def: number, min = -Infinity, max = Infinity): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid config ${key}=${raw} (expected number in [${min}, ${max}])`);
  return n;
}
function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], def: T): T {
  const v = (env[key] ?? def) as T;
  if (!allowed.includes(v)) throw new Error(`Invalid config ${key}=${env[key]} (allowed: ${allowed.join(', ')})`);
  return v;
}

/** Fails fast on missing/weak secrets. Note: ML_FAIL_MODE deliberately has no "accept" option. */
export function loadConfig(env: Env = process.env): AppConfig {
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters');
  const keyB64 = env.SENSOR_SECRET_ENC_KEY ?? '';
  const encKey = Buffer.from(keyB64, 'base64');
  if (encKey.length !== 32) throw new Error('SENSOR_SECRET_ENC_KEY must be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`)');
  const flag = num(env, 'FLAG_THRESHOLD', 0.99, 0, 1);
  const quarantine = num(env, 'QUARANTINE_THRESHOLD', 0.999, 0, 1);
  if (!(flag < quarantine)) throw new Error('FLAG_THRESHOLD must be lower than QUARANTINE_THRESHOLD');
  const nodeEnv = env.NODE_ENV ?? 'development';
  return {
    nodeEnv, port: num(env, 'PORT', 4000, 1, 65535),
    corsOrigin: (env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    jwtSecret, jwtExpiresSeconds: num(env, 'JWT_EXPIRES_SECONDS', 3600, 60, 7 * 86400),
    cookieSecure: nodeEnv === 'production' || env.COOKIE_SECURE === 'true',
    rateLimitWindowMs: num(env, 'RATE_LIMIT_WINDOW_MS', 60_000, 1000), rateLimitMax: num(env, 'RATE_LIMIT_MAX', 300, 1),
    authRateLimitMax: num(env, 'AUTH_RATE_LIMIT_MAX', 10, 1), ingestRateLimitMax: num(env, 'INGEST_RATE_LIMIT_MAX', 600, 1),
    sensorSecretEncKey: encKey,
    timestampWindowSeconds: num(env, 'TIMESTAMP_WINDOW_SECONDS', 120, 1, 86400),
    mlServiceUrl: (env.ML_SERVICE_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
    mlTimeoutMs: num(env, 'ML_TIMEOUT_MS', 3000, 100, 60000), mlInternalToken: env.ML_INTERNAL_TOKEN ?? '',
    mlFailMode: oneOf(env, 'ML_FAIL_MODE', ['quarantine', 'reject'] as const, 'quarantine'),
    rangeViolationAction: oneOf(env, 'RANGE_VIOLATION_ACTION', ['quarantine', 'reject'] as const, 'quarantine'),
    flagThreshold: flag, quarantineThreshold: quarantine,
    forecastingUrl: env.FORECASTING_URL ? env.FORECASTING_URL.replace(/\/$/, '') : null,
    forecastingToken: env.FORECASTING_TOKEN ?? '',
    simulatorUrl: env.SIMULATOR_URL ? env.SIMULATOR_URL.replace(/\/$/, '') : null, simulatorToken: env.SIMULATOR_TOKEN ?? '',
    // keep in sync with ml-service/app/rules.py defaults
    limits: {
      temperature: [num(env, 'LIMIT_TEMP_MIN', -60), num(env, 'LIMIT_TEMP_MAX', 60)],
      humidity: [0, 100],
      pressure: [num(env, 'LIMIT_PRESSURE_MIN', 870), num(env, 'LIMIT_PRESSURE_MAX', 1085)],
      windSpeed: [0, num(env, 'LIMIT_WIND_MAX', 75)],
      windDirection: [0, 360],
      rainfall: [0, num(env, 'LIMIT_RAIN_MAX', 100)],
      solarRadiation: [0, num(env, 'LIMIT_SOLAR_MAX', 1500)],
    },
  };
}
