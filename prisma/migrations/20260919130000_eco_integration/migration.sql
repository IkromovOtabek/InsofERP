-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "ecoVehicleId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "ecoUserId" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "ecoDeliveryId" TEXT,
ADD COLUMN     "ecoError" TEXT,
ADD COLUMN     "ecoStatus" TEXT,
ADD COLUMN     "ecoSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_ecoVehicleId_key" ON "Vehicle"("ecoVehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_ecoUserId_key" ON "Employee"("ecoUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_ecoDeliveryId_key" ON "Trip"("ecoDeliveryId");

