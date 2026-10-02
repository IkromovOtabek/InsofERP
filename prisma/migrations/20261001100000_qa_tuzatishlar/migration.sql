-- QA tuzatishlari (2026-10-01): /verify kaliti, to'lovni kim kiritgani, mexanik texnik xizmat jurnali
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "verifyToken" TEXT;

-- CreateTable
CREATE TABLE "VehicleService" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "odometerKm" INTEGER,
    "cost" DECIMAL(18,2),
    "note" TEXT,
    "nextDueAt" TIMESTAMP(3),
    "nextDueKm" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleService_vehicleId_date_idx" ON "VehicleService"("vehicleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_verifyToken_key" ON "Trip"("verifyToken");

-- AddForeignKey
ALTER TABLE "VehicleService" ADD CONSTRAINT "VehicleService_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleService" ADD CONSTRAINT "VehicleService_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

