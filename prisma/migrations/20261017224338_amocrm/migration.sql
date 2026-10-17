-- CreateEnum
CREATE TYPE "AmoAuthMethod" AS ENUM ('TOKEN', 'OAUTH');

-- CreateEnum
CREATE TYPE "AmoConnStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "AmoDealState" AS ENUM ('PUSHING', 'IN_AMO', 'READY', 'ORDERED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "amoDealId" TEXT;

-- CreateTable
CREATE TABLE "AmoConnection" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "domain" TEXT NOT NULL,
    "accountId" INTEGER,
    "accountName" TEXT,
    "method" "AmoAuthMethod" NOT NULL,
    "clientId" TEXT,
    "clientSecretEnc" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "webhookKey" TEXT NOT NULL,
    "webhookOk" BOOLEAN NOT NULL DEFAULT false,
    "pipelineId" INTEGER,
    "stageNewLead" INTEGER,
    "stageToErp" INTEGER,
    "stageConfirmed" INTEGER,
    "stageDelivered" INTEGER,
    "stageClosed" INTEGER,
    "stageCancelled" INTEGER,
    "pushLeads" BOOLEAN NOT NULL DEFAULT true,
    "status" "AmoConnStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastPullAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "connectedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmoDeal" (
    "id" TEXT NOT NULL,
    "amoLeadId" INTEGER,
    "leadId" TEXT,
    "state" "AmoDealState" NOT NULL DEFAULT 'IN_AMO',
    "name" TEXT NOT NULL,
    "price" DECIMAL(18,2),
    "contactName" TEXT,
    "phone" TEXT,
    "companyName" TEXT,
    "inn" TEXT,
    "address" TEXT,
    "note" TEXT,
    "responsible" TEXT,
    "customerId" TEXT,
    "pushAttempts" INTEGER NOT NULL DEFAULT 0,
    "pushError" TEXT,
    "nextPushAt" TIMESTAMP(3),
    "syncedStage" INTEGER,
    "syncedPrice" DECIMAL(18,2),
    "syncError" TEXT,
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmoDeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmoConnection_webhookKey_key" ON "AmoConnection"("webhookKey");

-- CreateIndex
CREATE UNIQUE INDEX "AmoDeal_amoLeadId_key" ON "AmoDeal"("amoLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "AmoDeal_leadId_key" ON "AmoDeal"("leadId");

-- CreateIndex
CREATE INDEX "AmoDeal_state_nextPushAt_idx" ON "AmoDeal"("state", "nextPushAt");

-- CreateIndex
CREATE INDEX "AmoDeal_customerId_idx" ON "AmoDeal"("customerId");

-- CreateIndex
CREATE INDEX "Order_amoDealId_idx" ON "Order"("amoDealId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_amoDealId_fkey" FOREIGN KEY ("amoDealId") REFERENCES "AmoDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmoDeal" ADD CONSTRAINT "AmoDeal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmoDeal" ADD CONSTRAINT "AmoDeal_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

