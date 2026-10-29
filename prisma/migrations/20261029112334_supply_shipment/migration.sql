-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentItemStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "SupplyShipment" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "warehouseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "waybillNo" TEXT,
    "payment" "ReceiptPayment",
    "carrier" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "materialId" TEXT,
    "category" "MaterialCategory" NOT NULL DEFAULT 'XOMASHYO',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "status" "ShipmentItemStatus" NOT NULL DEFAULT 'PENDING',
    "acceptedQty" DECIMAL(18,3),
    "rejectReason" TEXT,
    "receiptId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupplyShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplyShipment_docNo_key" ON "SupplyShipment"("docNo");

-- CreateIndex
CREATE INDEX "SupplyShipment_status_date_idx" ON "SupplyShipment"("status", "date");

-- CreateIndex
CREATE INDEX "SupplyShipment_createdById_createdAt_idx" ON "SupplyShipment"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "SupplyShipmentItem_shipmentId_idx" ON "SupplyShipmentItem"("shipmentId");

-- CreateIndex
CREATE INDEX "SupplyShipmentItem_receiptId_idx" ON "SupplyShipmentItem"("receiptId");

-- AddForeignKey
ALTER TABLE "SupplyShipment" ADD CONSTRAINT "SupplyShipment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipment" ADD CONSTRAINT "SupplyShipment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipment" ADD CONSTRAINT "SupplyShipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipmentItem" ADD CONSTRAINT "SupplyShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "SupplyShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipmentItem" ADD CONSTRAINT "SupplyShipmentItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipmentItem" ADD CONSTRAINT "SupplyShipmentItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipmentItem" ADD CONSTRAINT "SupplyShipmentItem_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

