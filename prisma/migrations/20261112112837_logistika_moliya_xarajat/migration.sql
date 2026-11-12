-- AlterTable
ALTER TABLE "LogisticsTx" ADD COLUMN     "transportExpenseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsTx_transportExpenseId_key" ON "LogisticsTx"("transportExpenseId");

