-- AlterTable
ALTER TABLE "LogisticsEntry" ADD COLUMN     "realizationEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsEntry_realizationEntryId_key" ON "LogisticsEntry"("realizationEntryId");

