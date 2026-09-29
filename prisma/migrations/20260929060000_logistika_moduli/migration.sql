-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'PETROL', 'METHANE', 'PROPANE');

-- CreateEnum
CREATE TYPE "TripIssueKind" AS ENUM ('BREAKDOWN', 'TRAFFIC', 'SITE_NOT_READY', 'QUALITY', 'ACCIDENT', 'DECLINED', 'OTHER');

-- CreateEnum
CREATE TYPE "TransportExpenseKind" AS ENUM ('DRIVER_PAY', 'ROAD', 'REPAIR', 'PARTS', 'PARKING', 'FINE', 'WASH', 'OTHER');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "assignLeadMin" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "avgSpeedKmh" INTEGER NOT NULL DEFAULT 35,
ADD COLUMN     "gpsSilentMin" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "lateCritMin" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "lateWarnMin" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "loadedWarnMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "shiftEndHour" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "shiftStartHour" INTEGER NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "workSchedule" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "acceptedQty" DECIMAL(18,3),
ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "deliveryComment" TEXT,
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "plannedAt" TIMESTAMP(3),
ADD COLUMN     "returnedAt" TIMESTAMP(3),
ADD COLUMN     "returnedQty" DECIMAL(18,3),
ADD COLUMN     "unloadingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "fuelNormL100" DECIMAL(6,2),
ADD COLUMN     "fuelType" "FuelType",
ADD COLUMN     "hasGps" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inspectionUntil" TIMESTAMP(3),
ADD COLUMN     "insuranceCompany" TEXT,
ADD COLUMN     "insurancePolicy" TEXT,
ADD COLUMN     "insuranceUntil" TIMESTAMP(3),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "odometerKm" INTEGER,
ADD COLUMN     "year" INTEGER;

-- CreateTable
CREATE TABLE "TripIssue" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "kind" "TripIssueKind" NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'LOGISTICS',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "TripIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "deliveryHours" TEXT,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLog" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "tripId" TEXT,
    "fuelType" "FuelType" NOT NULL,
    "liters" DECIMAL(10,2) NOT NULL,
    "pricePerL" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "odometerKm" INTEGER,
    "station" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportExpense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "TransportExpenseKind" NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "tripId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripIssue_tripId_idx" ON "TripIssue"("tripId");

-- CreateIndex
CREATE INDEX "TripIssue_resolvedAt_idx" ON "TripIssue"("resolvedAt");

-- CreateIndex
CREATE INDEX "Site_customerId_idx" ON "Site"("customerId");

-- CreateIndex
CREATE INDEX "FuelLog_date_idx" ON "FuelLog"("date");

-- CreateIndex
CREATE INDEX "FuelLog_vehicleId_date_idx" ON "FuelLog"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "TransportExpense_date_idx" ON "TransportExpense"("date");

-- CreateIndex
CREATE INDEX "Order_deliveryDate_idx" ON "Order"("deliveryDate");

-- CreateIndex
CREATE INDEX "Order_siteId_idx" ON "Order"("siteId");

-- CreateIndex
CREATE INDEX "Trip_status_createdAt_idx" ON "Trip"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripIssue" ADD CONSTRAINT "TripIssue_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportExpense" ADD CONSTRAINT "TransportExpense_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportExpense" ADD CONSTRAINT "TransportExpense_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportExpense" ADD CONSTRAINT "TransportExpense_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: mavjud reyslarning "yo'lga chiqdi" vaqti audit jurnalidan
UPDATE "Trip" t SET "departedAt" = a.at
FROM (
  SELECT "entityId", MIN("createdAt") AS at FROM "AuditLog"
  WHERE entity = 'Trip' AND action = 'STATUS_CHANGE' AND "after"->>'status' = 'ON_ROAD'
  GROUP BY "entityId"
) a
WHERE t.id = a."entityId" AND t."departedAt" IS NULL;
