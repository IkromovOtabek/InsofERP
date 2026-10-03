-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "internalUrl" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "dbName" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'PROVISIONING',
    "plan" TEXT NOT NULL DEFAULT 'standard',
    "contactName" TEXT,
    "contactPhone" TEXT,
    "note" TEXT,
    "directorLogin" TEXT,
    "ecoApiUrl" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastStats" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantStat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "stats" JSONB NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_login_key" ON "SuperAdmin"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_domain_key" ON "Tenant"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_port_key" ON "Tenant"("port");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_dbName_key" ON "Tenant"("dbName");

-- CreateIndex
CREATE INDEX "ControlEvent_tenantId_createdAt_idx" ON "ControlEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ControlEvent_createdAt_idx" ON "ControlEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantStat_tenantId_day_key" ON "TenantStat"("tenantId", "day");

-- AddForeignKey
ALTER TABLE "ControlEvent" ADD CONSTRAINT "ControlEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlEvent" ADD CONSTRAINT "ControlEvent_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantStat" ADD CONSTRAINT "TenantStat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

