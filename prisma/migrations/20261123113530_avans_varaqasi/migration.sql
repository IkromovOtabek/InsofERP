-- CreateEnum
CREATE TYPE "AdvanceSheetStatus" AS ENUM ('DRAFT', 'SENT', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "EmployeeDebt" ADD COLUMN     "scheduled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AdvanceSheet" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "groupKey" TEXT,
    "groupLabel" TEXT,
    "status" "AdvanceSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "recipientId" TEXT,
    "doneAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "AdvanceSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceLine" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "earned" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "suggested" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "givenAt" TIMESTAMP(3),
    "givenById" TEXT,
    "cashTxId" TEXT,
    "changedAt" TIMESTAMP(3),

    CONSTRAINT "AdvanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceSheet_docNo_key" ON "AdvanceSheet"("docNo");

-- CreateIndex
CREATE INDEX "AdvanceSheet_month_status_idx" ON "AdvanceSheet"("month", "status");

-- CreateIndex
CREATE INDEX "AdvanceSheet_recipientId_status_idx" ON "AdvanceSheet"("recipientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceLine_cashTxId_key" ON "AdvanceLine"("cashTxId");

-- CreateIndex
CREATE INDEX "AdvanceLine_employeeId_idx" ON "AdvanceLine"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceLine_sheetId_employeeId_key" ON "AdvanceLine"("sheetId", "employeeId");

-- AddForeignKey
ALTER TABLE "AdvanceLine" ADD CONSTRAINT "AdvanceLine_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "AdvanceSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceLine" ADD CONSTRAINT "AdvanceLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceLine" ADD CONSTRAINT "AdvanceLine_cashTxId_fkey" FOREIGN KEY ("cashTxId") REFERENCES "CashTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

