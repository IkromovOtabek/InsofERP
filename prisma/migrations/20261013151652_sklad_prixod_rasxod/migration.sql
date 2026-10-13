-- CreateEnum
CREATE TYPE "ReceiptPayment" AS ENUM ('BANK', 'CASH');

-- AlterEnum
ALTER TYPE "StockMoveType" ADD VALUE 'ISSUE';

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "address" TEXT,
ADD COLUMN     "buyerId" TEXT,
ADD COLUMN     "payment" "ReceiptPayment",
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "recipientId" TEXT,
ADD COLUMN     "waybillNo" TEXT;

-- AlterTable
ALTER TABLE "GoodsReceiptItem" ADD COLUMN     "deliveryCost" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "unitPrice" DECIMAL(18,2),
ADD COLUMN     "unitPriceAt" TIMESTAMP(3),
ADD COLUMN     "unitPriceById" TEXT;

-- AlterTable
ALTER TABLE "StockMove" ADD COLUMN     "recipientId" TEXT;

-- CreateTable
CREATE TABLE "StockRecipient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockRecipient_name_key" ON "StockRecipient"("name");

-- CreateIndex
CREATE INDEX "StockMove_materialId_date_idx" ON "StockMove"("materialId", "date");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_unitPriceById_fkey" FOREIGN KEY ("unitPriceById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "StockRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "StockRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

