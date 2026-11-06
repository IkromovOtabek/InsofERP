-- CreateEnum
CREATE TYPE "LedgerRevenueType" AS ENUM ('BANK', 'CASH', 'OBJECT');

-- AlterTable
ALTER TABLE "FuelLog" ADD COLUMN     "entryId" TEXT;

-- AlterTable
ALTER TABLE "LogisticsEntry" ADD COLUMN     "cargo" TEXT,
ADD COLUMN     "dropoff" TEXT,
ADD COLUMN     "drumHours" DECIMAL(5,2),
ADD COLUMN     "pickup" TEXT,
ADD COLUMN     "revenueType" "LedgerRevenueType";

-- AlterTable
ALTER TABLE "TransportExpense" ADD COLUMN     "entryId" TEXT;

-- CreateIndex
CREATE INDEX "FuelLog_entryId_idx" ON "FuelLog"("entryId");

-- CreateIndex
CREATE INDEX "TransportExpense_entryId_idx" ON "TransportExpense"("entryId");

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LogisticsEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportExpense" ADD CONSTRAINT "TransportExpense_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LogisticsEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

