-- CreateTable
CREATE TABLE "LogisticsEntry" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "trips" INTEGER NOT NULL DEFAULT 0,
    "km" DECIMAL(10,1),
    "payAmount" DECIMAL(18,2),
    "payType" "DriverPayType",
    "payApprovedAt" TIMESTAMP(3),
    "payApprovedById" TEXT,
    "revenue" DECIMAL(18,2),
    "note" TEXT NOT NULL,
    "mechanicRequestId" TEXT,
    "clientToken" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "LogisticsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsEntry_docNo_key" ON "LogisticsEntry"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsEntry_mechanicRequestId_key" ON "LogisticsEntry"("mechanicRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsEntry_clientToken_key" ON "LogisticsEntry"("clientToken");

-- CreateIndex
CREATE INDEX "LogisticsEntry_date_idx" ON "LogisticsEntry"("date");

-- CreateIndex
CREATE INDEX "LogisticsEntry_driverId_date_idx" ON "LogisticsEntry"("driverId", "date");

-- CreateIndex
CREATE INDEX "LogisticsEntry_vehicleId_date_idx" ON "LogisticsEntry"("vehicleId", "date");

-- AddForeignKey
ALTER TABLE "LogisticsEntry" ADD CONSTRAINT "LogisticsEntry_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsEntry" ADD CONSTRAINT "LogisticsEntry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsEntry" ADD CONSTRAINT "LogisticsEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

