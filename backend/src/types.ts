/** String-literal mirrors of the Prisma enums, so core logic has no dependency on the generated client. */
export type Role = 'ADMIN' | 'SECURITY_ANALYST' | 'VIEWER';
export type SensorStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPICIOUS' | 'BLOCKED';
export type ProcessingStatus = 'PENDING' | 'AUTHENTICATED' | 'FORWARDED' | 'QUARANTINED' | 'REJECTED';
export type Decision = 'ACCEPT' | 'FLAG' | 'QUARANTINE' | 'REJECT';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type EventStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
export type EventType =
  | 'AUTHENTICATION_FAILURE' | 'INVALID_SIGNATURE' | 'REPLAY_ATTACK' | 'INVALID_TELEMETRY'
  | 'RULE_VIOLATION' | 'ANOMALOUS_TELEMETRY' | 'REPEATED_READINGS' | 'SENSOR_DRIFT'
  | 'BLOCKED_SENSOR' | 'ML_SERVICE_FAILURE' | 'SENSOR_FLAGGED';

export const READING_FIELDS = ['temperature', 'humidity', 'pressure', 'windSpeed', 'windDirection', 'rainfall', 'solarRadiation'] as const;
export type ReadingField = (typeof READING_FIELDS)[number];
export type Reading = Record<ReadingField, number>;

export interface RuleDetail { rule: string; category: string; severity: string; hard: boolean; message: string }

export interface MlResult {
  anomalyScore: number;          // percentile (0-1) of clean calibration scores; NOT a probability
  prediction: 'NORMAL' | 'ANOMALY';
  mlSeverity: 'NONE' | 'MODERATE' | 'STRONG';
  rulesTriggered: string[];
  ruleDetails: RuleDetail[];
  hardRuleViolation: boolean;
  explanation: string;
}
