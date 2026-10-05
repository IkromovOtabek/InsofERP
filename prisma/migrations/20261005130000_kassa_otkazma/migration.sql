-- Hisoblararo o'tkazma (kassa → bank, bank → kassa, kassa → kassa): CashTransfer hujjati va
-- CashTxType ga TRANSFER_OUT / TRANSFER_IN. O'tkazma yozuvlari faqat hisob qoldig'iga kiradi,
-- kirim/chiqim, P&L va pul oqimi hisobotlariga emas. (PostgreSQL 12+: bir migratsiyada bir nechta enum qiymati.)

-- AlterEnum
ALTER TYPE "CashTxType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "CashTxType" ADD VALUE 'TRANSFER_IN';

-- CreateTable
CREATE TABLE "CashTransfer" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "fee" DECIMAL(18,2),
    "feeAccountId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientToken" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,

    CONSTRAINT "CashTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashTransfer_docNo_key" ON "CashTransfer"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "CashTransfer_clientToken_key" ON "CashTransfer"("clientToken");

-- CreateIndex
CREATE INDEX "CashTransfer_date_idx" ON "CashTransfer"("date");

-- CreateIndex
CREATE INDEX "CashTransfer_fromAccountId_idx" ON "CashTransfer"("fromAccountId");

-- CreateIndex
CREATE INDEX "CashTransfer_toAccountId_idx" ON "CashTransfer"("toAccountId");

-- AddForeignKey
ALTER TABLE "CashTransfer" ADD CONSTRAINT "CashTransfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransfer" ADD CONSTRAINT "CashTransfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransfer" ADD CONSTRAINT "CashTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransfer" ADD CONSTRAINT "CashTransfer_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

