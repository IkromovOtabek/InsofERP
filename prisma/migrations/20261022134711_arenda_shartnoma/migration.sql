-- CreateEnum
CREATE TYPE "RentLeaseStatus" AS ENUM ('ACTIVE', 'ENDED');

-- DropIndex
DROP INDEX "RentCharge_shopId_month_key";

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "rentKwhPrice" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RentCharge" ADD COLUMN     "elecDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "leaseId" TEXT,
ADD COLUMN     "meterEnd" DECIMAL(18,3),
ADD COLUMN     "meterStart" DECIMAL(18,3);

-- AlterTable
ALTER TABLE "RentShop" ADD COLUMN     "electricityBilled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RentTx" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "leaseId" TEXT;

-- CreateTable
CREATE TABLE "RentLease" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "no" TEXT,
    "tenantName" TEXT,
    "phone" TEXT,
    "inn" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "deposit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "RentLeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "endedAt" DATE,
    "endReason" TEXT,
    "expiryNotice" INTEGER,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentPriceChange" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "fromMonth" DATE NOT NULL,
    "bankAmount" DECIMAL(18,2) NOT NULL,
    "cashAmount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentFile" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "leaseId" TEXT,
    "kind" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "RentFile_pkey" PRIMARY KEY ("id")
);

-- Mavjud ma'lumot: har do'konga bitta shartnoma (ijarada — ACTIVE, bo'sh joy — ENDED);
-- oy hisoblari va ijarachi kirimlari shu shartnomaga bog'lanadi
INSERT INTO "RentLease" ("id", "shopId", "tenantName", "phone", "inn", "startDate", "status", "endedAt", "endReason", "createdAt", "updatedAt")
SELECT
  'ls' || substr(md5(s."id" || random()::text), 1, 23),
  s."id", s."tenantName", s."phone", s."inn",
  COALESCE(LEAST(
    (SELECT MIN(c."month") FROM "RentCharge" c WHERE c."shopId" = s."id"),
    (SELECT MIN(t."month") FROM "RentTx" t WHERE t."shopId" = s."id" AND t."type" = 'INCOME'),
    (SELECT MIN(t."date")::date FROM "RentTx" t WHERE t."shopId" = s."id" AND t."type" = 'INCOME')
  ), s."createdAt"::date),
  CASE WHEN s."isActive" THEN 'ACTIVE'::"RentLeaseStatus" ELSE 'ENDED'::"RentLeaseStatus" END,
  CASE WHEN s."isActive" THEN NULL ELSE CURRENT_DATE END,
  CASE WHEN s."isActive" THEN NULL ELSE 'Bo''sh joy (shartnomagacha bo''lgan ma''lumot)' END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "RentShop" s
WHERE s."isActive"
   OR EXISTS (SELECT 1 FROM "RentCharge" c WHERE c."shopId" = s."id")
   OR EXISTS (SELECT 1 FROM "RentTx" t WHERE t."shopId" = s."id" AND t."type" = 'INCOME');

UPDATE "RentCharge" c SET "leaseId" = l."id" FROM "RentLease" l WHERE l."shopId" = c."shopId";
UPDATE "RentTx" t SET "leaseId" = l."id" FROM "RentLease" l WHERE l."shopId" = t."shopId" AND t."type" = 'INCOME';

ALTER TABLE "RentCharge" ALTER COLUMN "leaseId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "RentLease_shopId_status_idx" ON "RentLease"("shopId", "status");

-- CreateIndex
CREATE INDEX "RentLease_status_endDate_idx" ON "RentLease"("status", "endDate");

-- CreateIndex
CREATE INDEX "RentPriceChange_shopId_appliedAt_idx" ON "RentPriceChange"("shopId", "appliedAt");

-- CreateIndex
CREATE INDEX "RentFile_shopId_removedAt_idx" ON "RentFile"("shopId", "removedAt");

-- CreateIndex
CREATE INDEX "RentCharge_shopId_month_idx" ON "RentCharge"("shopId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "RentCharge_leaseId_month_key" ON "RentCharge"("leaseId", "month");

-- CreateIndex
CREATE INDEX "RentTx_leaseId_month_idx" ON "RentTx"("leaseId", "month");

-- CreateIndex
CREATE INDEX "RentTx_batchId_idx" ON "RentTx"("batchId");

-- AddForeignKey
ALTER TABLE "RentLease" ADD CONSTRAINT "RentLease_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "RentShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentPriceChange" ADD CONSTRAINT "RentPriceChange_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "RentShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentFile" ADD CONSTRAINT "RentFile_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "RentShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentFile" ADD CONSTRAINT "RentFile_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "RentLease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentCharge" ADD CONSTRAINT "RentCharge_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "RentLease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentTx" ADD CONSTRAINT "RentTx_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "RentLease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

