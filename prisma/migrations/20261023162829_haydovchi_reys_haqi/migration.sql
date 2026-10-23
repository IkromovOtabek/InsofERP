-- CreateEnum
CREATE TYPE "CapacityUnit" AS ENUM ('M3', 'TON', 'PIECE');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "drvKmRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "drvTripRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "drvWaitHourRate" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "drumTurns" INTEGER,
ADD COLUMN     "payAmount" DECIMAL(18,2),
ADD COLUMN     "payKm" DECIMAL(10,1),
ADD COLUMN     "payNote" TEXT,
ADD COLUMN     "paySuggested" DECIMAL(18,2),
ADD COLUMN     "pricedAt" TIMESTAMP(3),
ADD COLUMN     "pricedById" TEXT,
ADD COLUMN     "waitMin" INTEGER,
ADD COLUMN     "workHours" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "capacityUnit" "CapacityUnit" NOT NULL DEFAULT 'M3',
ADD COLUMN     "idleNormPerHour" DECIMAL(6,2);

-- CreateIndex
CREATE INDEX "Trip_status_pricedAt_idx" ON "Trip"("status", "pricedAt");

