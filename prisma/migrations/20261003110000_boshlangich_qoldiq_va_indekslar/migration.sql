-- CreateEnum
CREATE TYPE "OpeningKind" AS ENUM ('CUSTOMER', 'SUPPLIER', 'CASH', 'STOCK');

-- AlterEnum
ALTER TYPE "CashTxType" ADD VALUE 'OPENING';

-- DropForeignKey
ALTER TABLE "AiAction" DROP CONSTRAINT "AiAction_userId_fkey";

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeDocument" DROP CONSTRAINT "EmployeeDocument_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "HrDocument" DROP CONSTRAINT "HrDocument_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "TaskProgress" DROP CONSTRAINT "TaskProgress_taskId_fkey";

-- AlterTable
ALTER TABLE "AiAction" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "contactPerson" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "isOpening" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contactPerson" TEXT;

-- CreateTable
CREATE TABLE "OpeningBalance" (
    "id" TEXT NOT NULL,
    "kind" "OpeningKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "cashAccountId" TEXT,
    "productId" TEXT,
    "warehouseId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "qty" DECIMAL(18,3),
    "unitCost" DECIMAL(18,2),
    "note" TEXT,
    "activeKey" TEXT,
    "invoiceId" TEXT,
    "cashTxId" TEXT,
    "stockMoveId" TEXT,
    "createdById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_activeKey_key" ON "OpeningBalance"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_invoiceId_key" ON "OpeningBalance"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_cashTxId_key" ON "OpeningBalance"("cashTxId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_stockMoveId_key" ON "OpeningBalance"("stockMoveId");

-- CreateIndex
CREATE INDEX "OpeningBalance_kind_cancelledAt_idx" ON "OpeningBalance"("kind", "cancelledAt");

-- CreateIndex
CREATE INDEX "BrigadeTask_orderId_idx" ON "BrigadeTask"("orderId");

-- CreateIndex
CREATE INDEX "CashTransaction_supplierId_idx" ON "CashTransaction"("supplierId");

-- CreateIndex
CREATE INDEX "FuelLog_tripId_idx" ON "FuelLog"("tripId");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_receiptId_idx" ON "GoodsReceiptItem"("receiptId");

-- CreateIndex
CREATE INDEX "Lead_customerId_idx" ON "Lead"("customerId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "ProductionBatch_orderId_idx" ON "ProductionBatch"("orderId");

-- CreateIndex
CREATE INDEX "SupplyRequest_supplierId_idx" ON "SupplyRequest"("supplierId");

-- CreateIndex
CREATE INDEX "TaskProgress_taskId_idx" ON "TaskProgress"("taskId");

-- CreateIndex
CREATE INDEX "TransportExpense_tripId_idx" ON "TransportExpense"("tripId");

-- CreateIndex
CREATE INDEX "Trip_vehicleId_idx" ON "Trip"("vehicleId");

-- CreateIndex
CREATE INDEX "Trip_driverId_idx" ON "Trip"("driverId");

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskProgress" ADD CONSTRAINT "TaskProgress_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BrigadeTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_cashTxId_fkey" FOREIGN KEY ("cashTxId") REFERENCES "CashTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_stockMoveId_fkey" FOREIGN KEY ("stockMoveId") REFERENCES "StockMove"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAction" ADD CONSTRAINT "AiAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

