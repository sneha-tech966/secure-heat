export type Role = 'ADMIN' | 'SECURITY_ANALYST' | 'VIEWER';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Decision = 'ACCEPT' | 'FLAG' | 'QUARANTINE' | 'REJECT';
export type ProcessingStatus = 'PENDING' | 'AUTHENTICATED' | 'FORWARDED' | 'QUARANTINED' | 'REJECTED';
export type SensorStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPICIOUS' | 'BLOCKED';
export type EventStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
export const EVENT_TYPES = ['AUTHENTICATION_FAILURE', 'INVALID_SIGNATURE', 'REPLAY_ATTACK', 'INVALID_TELEMETRY', 'RULE_VIOLATION', 'ANOMALOUS_TELEMETRY', 'REPEATED_READINGS', 'SENSOR_DRIFT', 'BLOCKED_SENSOR', 'ML_SERVICE_FAILURE', 'SENSOR_FLAGGED'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface User { id: string; name: string; email: string; role: Role; createdAt?: string }
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface RuleDetail { rule: string; category: string; severity: string; hard: boolean; message: string }

export interface Sensor { id: string; sensorId: string; name: string; location: string; latitude: number | null; longitude: number | null; status: SensorStatus; lastSeen: string | null; registeredAt: string; telemetryCount?: number; anomalyCount?: number; openEvents?: number }
export interface Credentials { apiKey: string; secret: string }

export interface TelemetryRow { id: string; sensorId: string; sequenceNumber: number; timestamp: string; temperature: number; humidity: number; pressure: number; windSpeed: number; windDirection: number; rainfall: number; solarRadiation: number; anomalyScore: number | null; anomalyStatus: 'NORMAL' | 'ANOMALY' | 'UNKNOWN'; decision: Decision; processingStatus: ProcessingStatus }
export interface TelemetryDetail {
  telemetry: TelemetryRow & { sensor: { sensorId: string; name: string; location: string; status: SensorStatus }; events: { id: string; eventType: EventType; severity: Severity; status: EventStatus; description: string; detectedAt: string }[]; receivedAt: string };
  pipeline: { authentication: { apiKeyVerified: boolean; signatureValid: boolean }; rules: RuleDetail[]; ml: { anomalyScore: number | null; anomalyStatus: string; explanation: string | null }; decision: Decision; processingStatus: ProcessingStatus; review: { by: { name: string; email: string } | null; at: string; notes: string | null } | null };
}

export interface SecurityEvent { id: string; eventType: EventType; severity: Severity; description: string; sensorId: string | null; claimedSensorId: string | null; telemetryId: string | null; sourceIP: string | null; detectedAt: string; status: EventStatus; resolutionNotes: string | null; resolvedAt: string | null; sensor?: { name: string } | null; investigatedBy?: { name: string } | null }
export interface AuditEntry { id: string; actorLabel: string; action: string; details: Record<string, unknown> | null; createdAt: string; targetType?: string; targetId?: string | null; ip?: string | null }
export interface EventDetail { event: SecurityEvent & { telemetry: (TelemetryRow & { explanation: string | null }) | null }; auditTrail: AuditEntry[] }

export interface QuarantineRow extends TelemetryRow { rulesTriggered: RuleDetail[]; explanation: string | null; quarantineReason: string; reviewNotes: string | null; reviewedAt: string | null; reviewedBy: { name: string } | null; events: { id: string; eventType: EventType; severity: Severity; description: string }[] }

export interface Overview {
  hours: number;
  kpis: { totalSensors: number; activeSensors: number; totalTelemetry: number; trustedReadings: number; anomaliesDetected: number; blockedRequests: number };
  telemetryVolume: { t: string; total: number; anomalous: number; normal: number }[];
  incidentsBySeverity: { severity: Severity; count: number }[];
  sensorActivity: { sensorId: string; readings: number; anomalous: number }[];
  scoreDistribution: { normal: Bin[]; anomalous: Bin[]; sampled: number };
  recentEvents: Pick<SecurityEvent, 'id' | 'eventType' | 'severity' | 'status' | 'sensorId' | 'claimedSensorId' | 'detectedAt' | 'description'>[];
  sensorHealth: { sensorId: string; name: string; location: string; status: SensorStatus; lastSeen: string | null; anomalies: number }[];
}
export interface Bin { from: number; to: number; count: number }
export interface ForecastPoint { step: number; value: number; lower: number; upper: number }
export interface Forecast { method: string; points: ForecastPoint[]; slopePerStep: number; basedOn: number }
export interface Trends { hours: number; trusted: { t: string; temperature: number | null; humidity: number | null; pressure: number | null; n: number }[]; naiveAllReadings: { t: string; temperature: number | null }[]; excluded: Record<string, number>; forecast: { temperature: Forecast; humidity: Forecast; pressure: Forecast }; note: string }

export interface Confusion { tn: number; fp: number; fn: number; tp: number }
export interface OperatingPoint { threshold_raw: number; precision: number; recall: number; f1: number; confusion: Confusion }
export interface ModelAnalytics {
  metrics: { modelName: string; trainedAt: string; datasetVersion: string; precision: number; recall: number; f1Score: number; rocAuc: number | null; averagePrecision: number | null; datasetSize: { fit: number; calibration: number; test: number; testAnomalies: number } | null; operatingPoints: { flag: OperatingPoint; quarantine: OperatingPoint } | null; byType: Record<string, { rows: number; rows_detected: number; events: number; events_detected: number }> | null; featureImportance: Record<string, number> | null } | null;
  info: { algorithm: string; features: string[]; trainingData: string; thresholds: { flag: number; quarantine: number; meaning: string }; featureImportanceMethod: string; limitations: string[] };
  distribution: { normal: Bin[]; anomalous: Bin[]; sampled: number }; history: { id: string; trainedAt: string; precision: number; recall: number; f1Score: number }[]; message?: string;
}
export interface SimStatus { running: boolean; scenario: string; target: string | null; ticksLeft: number; rate: number; sensors: string[]; stats: Record<string, number>; interval: number; scenarios: Record<string, string> }
export interface SimLogEntry { time: string; sensorId: string; sequence: number | null; scenario: string; reading: Record<string, number>; http: number | null; decision: Decision | null; status: string | null; code: string | null }
export interface SettingsView { readOnly: boolean; note: string; security: { timestampWindowSeconds: number; flagThreshold: number; quarantineThreshold: number; mlFailMode: string; rangeViolationAction: string; physicalLimits: Record<string, [number, number]> }; sessions: { jwtExpiresSeconds: number; cookieSecure: boolean; corsOrigin: string[] }; rateLimits: Record<string, number>; integrations: { mlService: string; mlTokenConfigured: boolean; externalForecastingConfigured: boolean; simulatorConfigured: boolean } }
