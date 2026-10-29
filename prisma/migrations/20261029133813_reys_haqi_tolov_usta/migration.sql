-- CreateEnum
CREATE TYPE "DriverPayType" AS ENUM ('CASH', 'PAYROLL');

-- AlterEnum
ALTER TYPE "MechanicRequestStatus" ADD VALUE 'DEFERRED';

-- AlterTable
ALTER TABLE "MechanicRequest" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "payee" TEXT,
ADD COLUMN     "tripId" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "payApprovedAt" TIMESTAMP(3),
ADD COLUMN     "payApprovedById" TEXT,
ADD COLUMN     "payRejectReason" TEXT,
ADD COLUMN     "payType" "DriverPayType";

-- CreateIndex
CREATE UNIQUE INDEX "MechanicRequest_tripId_key" ON "MechanicRequest"("tripId");

-- CreateIndex
CREATE INDEX "MechanicRequest_status_dueAt_idx" ON "MechanicRequest"("status", "dueAt");

