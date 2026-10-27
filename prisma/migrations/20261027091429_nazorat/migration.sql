-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "controlNotifyOwners" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "controlReportEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "controlReportHour" INTEGER NOT NULL DEFAULT 19,
ADD COLUMN     "fuelMaterialId" TEXT;

-- CreateTable
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "counted" DECIMAL(18,2) NOT NULL,
    "system" DECIMAL(18,2) NOT NULL,
    "diff" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlReport" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ControlReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashCount_day_idx" ON "CashCount"("day");

-- CreateIndex
CREATE UNIQUE INDEX "CashCount_cashAccountId_day_key" ON "CashCount"("cashAccountId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ControlReport_day_key" ON "ControlReport"("day");

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

