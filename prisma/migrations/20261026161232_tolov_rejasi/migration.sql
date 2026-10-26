-- CreateEnum
CREATE TYPE "PlannedFlowStatus" AS ENUM ('PLANNED', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "cashPlanFactor" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "dividendPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
ADD COLUMN     "supplierPaymentDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "paymentTermDays" INTEGER;

-- CreateTable
CREATE TABLE "RecurringPayment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "loanId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "RecurringPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedFlow" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "CashTxType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "counterparty" TEXT NOT NULL,
    "category" TEXT,
    "note" TEXT,
    "status" "PlannedFlowStatus" NOT NULL DEFAULT 'PLANNED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "PlannedFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringPayment_isActive_cancelledAt_idx" ON "RecurringPayment"("isActive", "cancelledAt");

-- CreateIndex
CREATE INDEX "PlannedFlow_status_date_idx" ON "PlannedFlow"("status", "date");

