-- AlterTable
ALTER TABLE "PayAdjustment" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "PayrollSettings" ADD COLUMN     "fundAmount" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "Withholding" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caseNo" TEXT,
    "creditor" TEXT,
    "amount" DECIMAL(18,2),
    "percent" DECIMAL(5,2),
    "monthly" DECIMAL(18,2),
    "startMonth" TEXT NOT NULL,
    "heldBefore" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,

    CONSTRAINT "Withholding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Withholding_employeeId_cancelledAt_idx" ON "Withholding"("employeeId", "cancelledAt");

-- AddForeignKey
ALTER TABLE "Withholding" ADD CONSTRAINT "Withholding_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

