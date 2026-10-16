-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('SALARY', 'DAILY', 'HOURLY', 'PIECE');

-- CreateEnum
CREATE TYPE "HrRequestKind" AS ENUM ('VACATION', 'UNPAID', 'SICK', 'DAYOFF', 'ADVANCE', 'LATE_REASON', 'ABSENCE_REASON', 'OTHER');

-- CreateEnum
CREATE TYPE "HrRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayAdjKind" AS ENUM ('BONUS', 'PENALTY');

-- CreateEnum
CREATE TYPE "PayRuleTrigger" AS ENUM ('LATE', 'ABSENT', 'EARLY_LEAVE', 'NO_LATE_MONTH', 'FULL_MONTH');

-- CreateEnum
CREATE TYPE "PayrollKind" AS ENUM ('ADVANCE', 'FINAL', 'EXTRA');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "payType" "PayType" NOT NULL DEFAULT 'SALARY';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "pieceRate" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "templateId" TEXT,
    "start" TEXT,
    "end" TEXT,
    "off" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRequest" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "HrRequestKind" NOT NULL,
    "dateFrom" DATE,
    "dateTo" DATE,
    "amount" DECIMAL(18,2),
    "reason" TEXT NOT NULL,
    "status" "HrRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedDays" INTEGER,
    "payrollRunId" TEXT,
    "createdById" TEXT NOT NULL,
    "clientToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PayAdjKind" NOT NULL,
    "trigger" "PayRuleTrigger" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "perMinute" BOOLEAN NOT NULL DEFAULT false,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxPerMonth" DECIMAL(18,2),
    "position" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayAdjustment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "kind" "PayAdjKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "date" DATE,
    "ruleId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "kind" "PayrollKind" NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "gross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payType" "PayType" NOT NULL,
    "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "normDays" INTEGER NOT NULL DEFAULT 0,
    "workedDays" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "units" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "base" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "leavePay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sickPay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "incomeTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "inps" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceDeducted" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "cashTxId" TEXT,
    "breakdown" JSONB,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "incomeTaxPct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "inpsPct" DECIMAL(5,2) NOT NULL DEFAULT 0.1,
    "socialTaxPct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "advancePct" INTEGER NOT NULL DEFAULT 40,
    "advanceDay" INTEGER NOT NULL DEFAULT 15,
    "sickPctShort" INTEGER NOT NULL DEFAULT 60,
    "sickPctLong" INTEGER NOT NULL DEFAULT 80,
    "vacationPaid" BOOLEAN NOT NULL DEFAULT true,
    "hoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftTemplate_name_key" ON "ShiftTemplate"("name");

-- CreateIndex
CREATE INDEX "ShiftAssignment_date_idx" ON "ShiftAssignment"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_employeeId_date_key" ON "ShiftAssignment"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HrRequest_docNo_key" ON "HrRequest"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "HrRequest_clientToken_key" ON "HrRequest"("clientToken");

-- CreateIndex
CREATE INDEX "HrRequest_employeeId_createdAt_idx" ON "HrRequest"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "HrRequest_status_kind_idx" ON "HrRequest"("status", "kind");

-- CreateIndex
CREATE INDEX "PayAdjustment_employeeId_month_idx" ON "PayAdjustment"("employeeId", "month");

-- CreateIndex
CREATE INDEX "PayAdjustment_month_idx" ON "PayAdjustment"("month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_docNo_key" ON "PayrollRun"("docNo");

-- CreateIndex
CREATE INDEX "PayrollRun_month_kind_idx" ON "PayrollRun"("month", "kind");

-- CreateIndex
CREATE INDEX "PayrollRun_status_idx" ON "PayrollRun"("status");

-- CreateIndex
CREATE INDEX "PayrollLine_employeeId_idx" ON "PayrollLine"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_runId_employeeId_key" ON "PayrollLine"("runId", "employeeId");

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequest" ADD CONSTRAINT "HrRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayAdjustment" ADD CONSTRAINT "PayAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayAdjustment" ADD CONSTRAINT "PayAdjustment_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PayRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

