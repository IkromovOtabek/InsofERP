-- Tayyor dona mahsulot brigada omborida: StockMove.ownerBrigadeId. Eski harakatlar bo'sh qoladi = «Umumiy hovli»
-- (oldingi jo'natishlar qaysi brigada mahsulotidan bo'lgani noma'lum) — taqsimlash mahsulot sahifasidagi «Ko'chirish» bilan.

-- AlterEnum
ALTER TYPE "StockMoveType" ADD VALUE 'OWNER_TRANSFER';

-- AlterTable
ALTER TABLE "StockMove" ADD COLUMN     "ownerBrigadeId" TEXT;

-- CreateIndex
CREATE INDEX "StockMove_ownerBrigadeId_productId_idx" ON "StockMove"("ownerBrigadeId", "productId");

-- AddForeignKey
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_ownerBrigadeId_fkey" FOREIGN KEY ("ownerBrigadeId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

