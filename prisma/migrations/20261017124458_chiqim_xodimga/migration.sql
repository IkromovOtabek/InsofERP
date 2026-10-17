-- AlterTable
ALTER TABLE "StockMove" ADD COLUMN     "employeeId" TEXT;

-- CreateIndex
CREATE INDEX "StockMove_employeeId_date_idx" ON "StockMove"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

