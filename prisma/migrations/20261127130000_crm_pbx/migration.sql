-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "pbxSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pbxExt" TEXT;

-- CreateTable
CREATE TABLE "CrmCall" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "ext" TEXT,
    "phone" TEXT,
    "userId" TEXT,
    "customerId" TEXT,
    "contactId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "talkSec" INTEGER NOT NULL DEFAULT 0,
    "hangupCause" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmCall_uuid_key" ON "CrmCall"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCall_contactId_key" ON "CrmCall"("contactId");

-- CreateIndex
CREATE INDEX "CrmCall_customerId_startedAt_idx" ON "CrmCall"("customerId", "startedAt");

-- CreateIndex
CREATE INDEX "CrmCall_userId_startedAt_idx" ON "CrmCall"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "CrmCall_startedAt_idx" ON "CrmCall"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_pbxExt_key" ON "User"("pbxExt");

-- AddForeignKey
ALTER TABLE "CrmCall" ADD CONSTRAINT "CrmCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCall" ADD CONSTRAINT "CrmCall_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCall" ADD CONSTRAINT "CrmCall_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

