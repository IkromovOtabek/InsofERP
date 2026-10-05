-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('OK', 'WARN', 'CRIT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'REJECTED');

-- CreateTable
CREATE TABLE "HostSnapshot" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPct" DOUBLE PRECISION NOT NULL,
    "load1" DOUBLE PRECISION NOT NULL,
    "load5" DOUBLE PRECISION NOT NULL,
    "load15" DOUBLE PRECISION NOT NULL,
    "memTotal" BIGINT NOT NULL,
    "memUsed" BIGINT NOT NULL,
    "swapTotal" BIGINT NOT NULL,
    "swapUsed" BIGINT NOT NULL,
    "diskTotal" BIGINT NOT NULL,
    "diskUsed" BIGINT NOT NULL,
    "uptimeSec" INTEGER NOT NULL,
    "netRxBps" BIGINT,
    "netTxBps" BIGINT,
    "extra" JSONB,

    CONSTRAINT "HostSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCheck" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" "CheckStatus" NOT NULL,
    "message" TEXT,
    "latencyMs" INTEGER,
    "data" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "suggestedActions" JSONB,
    "tenantId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "ackedById" TEXT,
    "ackedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "output" TEXT,
    "incidentId" TEXT,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentHeartbeat" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "info" JSONB,

    CONSTRAINT "AgentHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityReport" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "inputMeta" JSONB,
    "requestedById" TEXT,

    CONSTRAINT "SecurityReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HostSnapshot_takenAt_idx" ON "HostSnapshot"("takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCheck_key_key" ON "ServiceCheck"("key");

-- CreateIndex
CREATE INDEX "ServiceCheck_kind_idx" ON "ServiceCheck"("kind");

-- CreateIndex
CREATE INDEX "ServiceCheck_status_idx" ON "ServiceCheck"("status");

-- CreateIndex
CREATE INDEX "Incident_status_severity_idx" ON "Incident"("status", "severity");

-- CreateIndex
CREATE INDEX "Incident_key_status_idx" ON "Incident"("key", "status");

-- CreateIndex
CREATE INDEX "Incident_lastSeenAt_idx" ON "Incident"("lastSeenAt");

-- CreateIndex
CREATE INDEX "AgentAction_status_requestedAt_idx" ON "AgentAction"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "SecurityReport_createdAt_idx" ON "SecurityReport"("createdAt");

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

