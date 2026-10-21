import type { MlResult, Reading, RuleDetail } from '../types.js';
import { MlUnavailableError, type MlClient } from './ports.js';

export interface MlClientOptions { baseUrl: string; timeoutMs: number; token?: string }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Calls the FastAPI service. Any failure (network, timeout, non-2xx, malformed body) becomes MlUnavailableError so the
 *  decision engine can apply the configured fail-safe. The response is validated: we never trust its shape blindly. */
export class HttpMlClient implements MlClient {
  constructor(private readonly opts: MlClientOptions) {}

  async predict(sensorId: string, r: Reading, timestamp: string): Promise<MlResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(`${this.opts.baseUrl}/predict`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', ...(this.opts.token ? { 'x-internal-token': this.opts.token } : {}) },
        body: JSON.stringify({ sensor_id: sensorId, temperature: r.temperature, humidity: r.humidity, pressure: r.pressure,
          wind_speed: r.windSpeed, wind_direction: r.windDirection, rainfall: r.rainfall, solar_radiation: r.solarRadiation, timestamp }),
      });
      if (!res.ok) throw new MlUnavailableError(`ML service responded ${res.status}`);
      return parseMlResponse(await res.json());
    } catch (e) {
      if (e instanceof MlUnavailableError) throw e;
      throw new MlUnavailableError(e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'request failed');
    } finally { clearTimeout(timer); }
  }
}

export function parseMlResponse(j: unknown): MlResult {
  const o = j as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !isNum(o.anomaly_score) || o.anomaly_score < 0 || o.anomaly_score > 1
      || (o.prediction !== 'NORMAL' && o.prediction !== 'ANOMALY') || !Array.isArray(o.rule_details)
      || typeof o.explanation !== 'string') throw new MlUnavailableError('malformed ML response');
  const ruleDetails: RuleDetail[] = o.rule_details.map((r: any) => ({
    rule: String(r.rule), category: String(r.category), severity: String(r.severity), hard: r.hard === true, message: String(r.message) }));
  return {
    anomalyScore: o.anomaly_score, prediction: o.prediction,
    mlSeverity: (o.ml_severity as MlResult['mlSeverity']) ?? 'NONE',
    rulesTriggered: ruleDetails.map((r) => r.rule), ruleDetails,
    hardRuleViolation: o.hard_rule_violation === true || ruleDetails.some((r) => r.hard),
    explanation: o.explanation,
  };
}
