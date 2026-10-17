-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "autoIssueBrigadeId" TEXT,
ADD COLUMN     "autoIssueEmployeeId" TEXT;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_autoIssueBrigadeId_fkey" FOREIGN KEY ("autoIssueBrigadeId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_autoIssueEmployeeId_fkey" FOREIGN KEY ("autoIssueEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

