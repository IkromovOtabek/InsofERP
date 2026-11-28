-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CALL_CENTER';

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "pbxWebhookAt" TIMESTAMP(3),
ADD COLUMN     "pbxWebhookKey" TEXT;

-- AlterTable
ALTER TABLE "CrmCall" ADD COLUMN     "handledAt" TIMESTAMP(3),
ADD COLUMN     "handledById" TEXT,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'ENDED',
ADD COLUMN     "takenAt" TIMESTAMP(3),
ADD COLUMN     "takenById" TEXT;

-- CreateIndex
CREATE INDEX "CrmCall_direction_handledAt_idx" ON "CrmCall"("direction", "handledAt");

-- CreateIndex
CREATE INDEX "CrmCall_state_idx" ON "CrmCall"("state");

-- AddForeignKey
ALTER TABLE "CrmCall" ADD CONSTRAINT "CrmCall_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCall" ADD CONSTRAINT "CrmCall_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

