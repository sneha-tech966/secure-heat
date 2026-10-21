-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SECURITY_ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "SensorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPICIOUS', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'AUTHENTICATED', 'FORWARDED', 'QUARANTINED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('ACCEPT', 'FLAG', 'QUARANTINE', 'REJECT');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('NORMAL', 'ANOMALY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('AUTHENTICATION_FAILURE', 'INVALID_SIGNATURE', 'REPLAY_ATTACK', 'INVALID_TELEMETRY', 'RULE_VIOLATION', 'ANOMALOUS_TELEMETRY', 'REPEATED_READINGS', 'SENSOR_DRIFT', 'BLOCKED_SENSOR', 'ML_SERVICE_FAILURE', 'SENSOR_FLAGGED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sensor" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "apiKeyHash" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "status" "SensorStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeen" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Telemetry" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "humidity" DOUBLE PRECISION NOT NULL,
    "pressure" DOUBLE PRECISION NOT NULL,
    "windSpeed" DOUBLE PRECISION NOT NULL,
    "windDirection" DOUBLE PRECISION NOT NULL,
    "rainfall" DOUBLE PRECISION NOT NULL,
    "solarRadiation" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureValid" BOOLEAN NOT NULL,
    "anomalyScore" DOUBLE PRECISION,
    "anomalyStatus" "AnomalyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "decision" "Decision" NOT NULL,
    "rulesTriggered" JSONB NOT NULL DEFAULT '[]',
    "explanation" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "description" TEXT NOT NULL,
    "sensorId" TEXT,
    "claimedSensorId" TEXT,
    "telemetryId" TEXT,
    "sourceIP" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "EventStatus" NOT NULL DEFAULT 'OPEN',
    "investigatedById" TEXT,
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelMetrics" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION NOT NULL,
    "recall" DOUBLE PRECISION NOT NULL,
    "f1Score" DOUBLE PRECISION NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayRecord" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Sensor_sensorId_key" ON "Sensor"("sensorId");

-- CreateIndex
CREATE INDEX "Sensor_status_idx" ON "Sensor"("status");

-- CreateIndex
CREATE INDEX "Telemetry_sensorId_timestamp_idx" ON "Telemetry"("sensorId", "timestamp");

-- CreateIndex
CREATE INDEX "Telemetry_processingStatus_timestamp_idx" ON "Telemetry"("processingStatus", "timestamp");

-- CreateIndex
CREATE INDEX "Telemetry_receivedAt_idx" ON "Telemetry"("receivedAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_severity_detectedAt_idx" ON "SecurityEvent"("severity", "detectedAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_eventType_idx" ON "SecurityEvent"("eventType");

-- CreateIndex
CREATE INDEX "SecurityEvent_status_idx" ON "SecurityEvent"("status");

-- CreateIndex
CREATE INDEX "SecurityEvent_sensorId_detectedAt_idx" ON "SecurityEvent"("sensorId", "detectedAt");

-- CreateIndex
CREATE INDEX "ModelMetrics_trainedAt_idx" ON "ModelMetrics"("trainedAt");

-- CreateIndex
CREATE INDEX "ReplayRecord_timestamp_idx" ON "ReplayRecord"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayRecord_sensorId_sequenceNumber_key" ON "ReplayRecord"("sensorId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Telemetry" ADD CONSTRAINT "Telemetry_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("sensorId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Telemetry" ADD CONSTRAINT "Telemetry_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("sensorId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_telemetryId_fkey" FOREIGN KEY ("telemetryId") REFERENCES "Telemetry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_investigatedById_fkey" FOREIGN KEY ("investigatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayRecord" ADD CONSTRAINT "ReplayRecord_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("sensorId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
