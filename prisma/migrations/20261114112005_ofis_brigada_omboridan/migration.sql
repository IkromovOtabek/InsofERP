-- AlterEnum
ALTER TYPE "MaterialCategory" ADD VALUE 'OFIS';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "stockBrigadeId" TEXT;

-- CreateIndex
CREATE INDEX "OrderItem_stockBrigadeId_idx" ON "OrderItem"("stockBrigadeId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_stockBrigadeId_fkey" FOREIGN KEY ("stockBrigadeId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

