-- IT panel xavfsizligi: admin rollari, ikki bosqichli kirish (TOTP) va sessiyalar jadvali.
-- Mavjud adminlar OWNER bo'ladi (hozir hammasi to'liq huquqli edi); yangi qo'shilganlar sukut bo'yicha OPERATOR.

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'OPERATOR', 'VIEWER');

-- AlterTable
ALTER TABLE "SuperAdmin" ADD COLUMN     "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "role" "AdminRole" NOT NULL DEFAULT 'OPERATOR',
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminSession_adminId_revokedAt_idx" ON "AdminSession"("adminId", "revokedAt");

-- CreateIndex
CREATE INDEX "AdminSession_adminId_ip_idx" ON "AdminSession"("adminId", "ip");

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mavjud adminlar — to'liq huquq saqlanadi
UPDATE "SuperAdmin" SET "role" = 'OWNER';
