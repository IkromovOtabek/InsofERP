-- Hisobni o'chirish so'rovlari (App Store / Google Play talabi): xodim ilovadan, ECO haydovchisi
-- webhook orqali, tashqi odam saytdan so'raydi; direktor Sozlamalar > Hisob so'rovlari da tasdiqlaydi.
-- CreateEnum
CREATE TYPE "DeletionRequestSource" AS ENUM ('APP', 'ECO', 'WEB');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "source" "DeletionRequestSource" NOT NULL,
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "employeeId" TEXT,
    "ecoUserId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_createdAt_idx" ON "AccountDeletionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_phone_idx" ON "AccountDeletionRequest"("phone");

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

