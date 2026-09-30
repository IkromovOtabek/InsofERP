-- Snabjeniye TZ: talabnoma rekvizitlari, direktor tasdig'i, yetkazib berish monitoringi, tijorat takliflari, muammolar, hujjatlar
-- CreateEnum
CREATE TYPE "SupplyPriority" AS ENUM ('NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SupplyDelivery" AS ENUM ('PLANNED', 'IN_TRANSIT', 'ARRIVED', 'RECEIVING', 'RECEIVED', 'PROBLEM');

-- CreateEnum
CREATE TYPE "SupplyIncidentKind" AS ENUM ('SHORTAGE', 'QUALITY', 'DELAY', 'DOCS', 'OTHER');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "supplyDirectorLimit" DECIMAL(18,2) NOT NULL DEFAULT 50000000;

-- AlterTable
ALTER TABLE "SupplyRequest" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "contractNo" TEXT,
ADD COLUMN     "deliveryStatus" "SupplyDelivery",
ADD COLUMN     "department" TEXT,
ADD COLUMN     "directorOkAt" TIMESTAMP(3),
ADD COLUMN     "directorOkById" TEXT,
ADD COLUMN     "eta" TIMESTAMP(3),
ADD COLUMN     "priority" "SupplyPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "responsibleId" TEXT,
ADD COLUMN     "shippedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SupplyQuote" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "deliveryDays" INTEGER,
    "paymentTerms" TEXT,
    "validUntil" TIMESTAMP(3),
    "note" TEXT,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyIncident" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "SupplyIncidentKind" NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "SupplyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplyQuote_requestId_idx" ON "SupplyQuote"("requestId");

-- CreateIndex
CREATE INDEX "SupplyIncident_requestId_idx" ON "SupplyIncident"("requestId");

-- CreateIndex
CREATE INDEX "SupplyIncident_resolvedAt_idx" ON "SupplyIncident"("resolvedAt");

-- CreateIndex
CREATE INDEX "SupplyDocument_requestId_idx" ON "SupplyDocument"("requestId");

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyQuote" ADD CONSTRAINT "SupplyQuote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyQuote" ADD CONSTRAINT "SupplyQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyQuote" ADD CONSTRAINT "SupplyQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyIncident" ADD CONSTRAINT "SupplyIncident_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyIncident" ADD CONSTRAINT "SupplyIncident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDocument" ADD CONSTRAINT "SupplyDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDocument" ADD CONSTRAINT "SupplyDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

