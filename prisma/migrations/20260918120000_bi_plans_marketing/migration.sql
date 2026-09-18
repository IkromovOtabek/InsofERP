-- CreateEnum
CREATE TYPE "MarketingEntryKind" AS ENUM ('BUDGET', 'PLAN', 'FACT');

-- CreateTable
CREATE TABLE "SalesPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "sellerId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "volumeM3" DECIMAL(18,3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEntry" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "kind" "MarketingEntryKind" NOT NULL,
    "channel" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "leads" INTEGER,
    "customers" INTEGER,
    "revenue" DECIMAL(18,2),
    "impressions" INTEGER,
    "clicks" INTEGER,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesPlan_year_month_idx" ON "SalesPlan"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlan_year_month_sellerId_key" ON "SalesPlan"("year", "month", "sellerId");

-- CreateIndex
CREATE INDEX "MarketingEntry_year_month_idx" ON "MarketingEntry"("year", "month");

-- AddForeignKey
ALTER TABLE "MarketingEntry" ADD CONSTRAINT "MarketingEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

