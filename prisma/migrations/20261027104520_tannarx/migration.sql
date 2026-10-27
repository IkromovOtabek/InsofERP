-- AlterTable
ALTER TABLE "CashCategory" ADD COLUMN     "inCost" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "cashDailyFlags" JSONB,
ADD COLUMN     "cashSalesPlan" JSONB;

-- AlterTable
ALTER TABLE "ProductGroup" ADD COLUMN     "pieceRate" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "CostMonth" (
    "id" TEXT NOT NULL,
    "coefs" JSONB,
    "overheadPct" DECIMAL(6,2),
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostMonth_pkey" PRIMARY KEY ("id")
);

-- Ishlab chiqarish xarajatlari (jadvaldagi «Zavod xarajatlari», «Kommunal», «Oziq-ovqat») sukut bo'yicha tannarxga kiradi
UPDATE "CashCategory" SET "inCost" = true WHERE "parentId" IS NULL AND "pnlLine" = 'PRODUCTION' AND "name" <> 'Boshqa chiqim';
