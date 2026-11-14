-- AlterTable
ALTER TABLE "CashTransaction" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "CustomerDebtTransfer" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "debtorId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "CustomerDebtTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDebtTransfer_docNo_key" ON "CustomerDebtTransfer"("docNo");

-- CreateIndex
CREATE INDEX "CustomerDebtTransfer_debtorId_idx" ON "CustomerDebtTransfer"("debtorId");

-- CreateIndex
CREATE INDEX "CustomerDebtTransfer_payerId_idx" ON "CustomerDebtTransfer"("payerId");

-- CreateIndex
CREATE INDEX "CustomerDebtTransfer_date_idx" ON "CustomerDebtTransfer"("date");

-- CreateIndex
CREATE INDEX "CashTransaction_customerId_idx" ON "CashTransaction"("customerId");

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDebtTransfer" ADD CONSTRAINT "CustomerDebtTransfer_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDebtTransfer" ADD CONSTRAINT "CustomerDebtTransfer_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDebtTransfer" ADD CONSTRAINT "CustomerDebtTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

