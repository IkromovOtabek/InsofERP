-- CreateEnum
CREATE TYPE "MechanicTarget" AS ENUM ('TRANSPORT', 'FACTORY', 'OTHER');

-- CreateEnum
CREATE TYPE "MechanicRequestStatus" AS ENUM ('NEW', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "checkInOutside" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkInPlacePhoto" TEXT,
ADD COLUMN     "checkOutOutside" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkOutPlacePhoto" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "attendanceAnywhere" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MechanicRequest" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "target" "MechanicTarget" NOT NULL,
    "vehicleId" TEXT,
    "object" TEXT,
    "problem" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "photo" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "MechanicRequestStatus" NOT NULL DEFAULT 'NEW',
    "clientToken" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "cashAccountId" TEXT,
    "cashTxId" TEXT,
    "transportExpenseId" TEXT,

    CONSTRAINT "MechanicRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MechanicRequest_docNo_key" ON "MechanicRequest"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "MechanicRequest_clientToken_key" ON "MechanicRequest"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "MechanicRequest_cashTxId_key" ON "MechanicRequest"("cashTxId");

-- CreateIndex
CREATE UNIQUE INDEX "MechanicRequest_transportExpenseId_key" ON "MechanicRequest"("transportExpenseId");

-- CreateIndex
CREATE INDEX "MechanicRequest_status_createdAt_idx" ON "MechanicRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MechanicRequest_createdById_createdAt_idx" ON "MechanicRequest"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "MechanicRequest_vehicleId_idx" ON "MechanicRequest"("vehicleId");

-- AddForeignKey
ALTER TABLE "MechanicRequest" ADD CONSTRAINT "MechanicRequest_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicRequest" ADD CONSTRAINT "MechanicRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

