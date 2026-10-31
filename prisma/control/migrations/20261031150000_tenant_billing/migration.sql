-- Korxona obunasi: to'langan muddat, oylik to'lov, imtiyozli kunlar, to'xtatish turi va to'lovlar jurnali.
-- Mavjud korxonalarda paidUntil bo'sh (muddatsiz) — avtomat ularni to'xtatmaydi, IT muddatni qo'lda belgilaydi.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billingNotice" TEXT,
ADD COLUMN     "graceDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "monthlyFee" DECIMAL(18,2),
ADD COLUMN     "paidUntil" DATE,
ADD COLUMN     "suspendKind" TEXT;

-- CreateTable
CREATE TABLE "TenantPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "months" INTEGER NOT NULL,
    "paidAt" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "prevPaidUntil" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "TenantPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantPayment_tenantId_createdAt_idx" ON "TenantPayment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "TenantPayment_paidAt_idx" ON "TenantPayment"("paidAt");

-- AddForeignKey
ALTER TABLE "TenantPayment" ADD CONSTRAINT "TenantPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

