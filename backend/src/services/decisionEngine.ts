import type { Decision, EventType, MlResult, ProcessingStatus, RuleDetail, Severity } from '../types.js';

export interface DecisionConfig {
  flagThreshold: number; quarantineThreshold: number;
  mlFailMode: 'quarantine' | 'reject'; rangeViolationAction: 'quarantine' | 'reject';
}
export interface DecisionInput { hardRules: RuleDetail[]; ml: MlResult | null; mlError?: string | null; cfg: DecisionConfig }
export interface DecisionOutput {
  decision: Decision; processingStatus: ProcessingStatus;
  eventType: EventType | null; severity: Severity | null; reasons: string[];
}

const HOLD: Record<Decision, ProcessingStatus> = { ACCEPT: 'AUTHENTICATED', FLAG: 'QUARANTINED', QUARANTINE: 'QUARANTINED', REJECT: 'REJECTED' };
const out = (decision: Decision, eventType: EventType | null, severity: Severity | null, reasons: string[]): DecisionOutput =>
  ({ decision, processingStatus: HOLD[decision], eventType, severity, reasons });

/**
 * Combines authentication-independent evidence into a decision. Authentication / signature / replay / schema failures
 * are handled earlier in the pipeline (they REJECT before any telemetry exists).
 * Precedence: impossible values > ML outage (fail-safe) > strong ML anomaly > moderate anomaly or soft rule > accept.
 * FLAG is held out of the trusted stream until a human reviews it: an unusual reading is NOT proof of an attack.
 * Severity reflects corroboration: strong ML + an independent soft rule => CRITICAL.
 */
export function decide({ hardRules, ml, mlError, cfg }: DecisionInput): DecisionOutput {
  const soft = ml ? ml.ruleDetails.filter((r) => !r.hard) : [];
  const hard = [...hardRules, ...(ml ? ml.ruleDetails.filter((r) => r.hard) : [])];
  if (hard.length) {
    const d: Decision = cfg.rangeViolationAction === 'reject' ? 'REJECT' : 'QUARANTINE';
    return out(d, 'RULE_VIOLATION', 'HIGH', hard.map((r) => r.message));
  }
  if (!ml) {
    const d: Decision = cfg.mlFailMode === 'reject' ? 'REJECT' : 'QUARANTINE';
    return out(d, 'ML_SERVICE_FAILURE', 'MEDIUM', [`ML service unavailable (${mlError ?? 'unknown'}); fail-safe: ${cfg.mlFailMode}`]);
  }
  const score = ml.anomalyScore;
  const reasons = [ml.explanation, ...soft.map((r) => r.message)].filter(Boolean);
  const repeat = soft.some((r) => r.category === 'repeat');
  if (score >= cfg.quarantineThreshold) {
    return out('QUARANTINE', 'ANOMALOUS_TELEMETRY', soft.length ? 'CRITICAL' : 'HIGH', reasons);
  }
  if (score >= cfg.flagThreshold || soft.length) {
    return out('FLAG', repeat ? 'REPEATED_READINGS' : 'ANOMALOUS_TELEMETRY', soft.length && score >= cfg.flagThreshold ? 'HIGH' : soft.length ? 'MEDIUM' : 'LOW', reasons);
  }
  return out('ACCEPT', null, null, []);
}
