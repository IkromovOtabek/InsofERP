-- CreateEnum
CREATE TYPE "SupplyStatus" AS ENUM ('NEW', 'PRICED', 'APPROVED', 'FUNDED', 'RECEIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BrigadeMoveType" AS ENUM ('ISSUE', 'RETURN', 'CONSUME', 'WRITE_OFF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMoveType" ADD VALUE 'BRIGADE_ISSUE';
ALTER TYPE "StockMoveType" ADD VALUE 'BRIGADE_RETURN';

-- AlterTable
ALTER TABLE "StockMove" ADD COLUMN     "brigadeId" TEXT;

-- CreateTable
CREATE TABLE "SupplyRequest" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SupplyStatus" NOT NULL DEFAULT 'NEW',
    "warehouseId" TEXT NOT NULL,
    "needBy" TIMESTAMP(3),
    "note" TEXT,
    "supplierId" TEXT,
    "cashAccountId" TEXT,
    "cashTxId" TEXT,
    "receiptId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "materialId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "factQty" DECIMAL(18,3),
    "factPrice" DECIMAL(18,2),
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupplyRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stage" "SupplyStatus" NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrigadeMove" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "BrigadeMoveType" NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,2),
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrigadeMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplyRequest_docNo_key" ON "SupplyRequest"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyRequest_receiptId_key" ON "SupplyRequest"("receiptId");

-- CreateIndex
CREATE INDEX "SupplyRequest_status_date_idx" ON "SupplyRequest"("status", "date");

-- CreateIndex
CREATE INDEX "SupplyRequestItem_requestId_idx" ON "SupplyRequestItem"("requestId");

-- CreateIndex
CREATE INDEX "SupplyEvent_requestId_createdAt_idx" ON "SupplyEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "BrigadeMove_brigadeId_materialId_date_idx" ON "BrigadeMove"("brigadeId", "materialId", "date");

-- CreateIndex
CREATE INDEX "BrigadeMove_refType_refId_idx" ON "BrigadeMove"("refType", "refId");

-- AddForeignKey
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequestItem" ADD CONSTRAINT "SupplyRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequestItem" ADD CONSTRAINT "SupplyRequestItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvent" ADD CONSTRAINT "SupplyEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvent" ADD CONSTRAINT "SupplyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeMove" ADD CONSTRAINT "BrigadeMove_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeMove" ADD CONSTRAINT "BrigadeMove_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeMove" ADD CONSTRAINT "BrigadeMove_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
