-- AlterTable
ALTER TABLE "StockMove" ADD COLUMN     "vehicleId" TEXT;

-- CreateIndex
CREATE INDEX "StockMove_vehicleId_date_idx" ON "StockMove"("vehicleId", "date");

-- AddForeignKey
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

