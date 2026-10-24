-- AlterEnum
ALTER TYPE "FuelType" ADD VALUE 'DIESEL_METHANE';

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "gasIdlePerHour" DECIMAL(6,2),
ADD COLUMN     "gasNormPer100" DECIMAL(6,2),
ADD COLUMN     "mainDriverId" TEXT;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_mainDriverId_fkey" FOREIGN KEY ("mainDriverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

