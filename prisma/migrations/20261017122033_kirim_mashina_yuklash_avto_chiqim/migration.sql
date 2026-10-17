-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "autoIssueToId" TEXT,
ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "loadedFrom" TEXT;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_autoIssueToId_fkey" FOREIGN KEY ("autoIssueToId") REFERENCES "StockRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

