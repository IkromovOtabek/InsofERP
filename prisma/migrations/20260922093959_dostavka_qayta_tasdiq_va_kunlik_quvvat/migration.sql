-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "dailyCapacityM3" DECIMAL(10,2) DEFAULT 200;

-- AlterTable
ALTER TABLE "SupplyRequest" ADD COLUMN     "deliveryCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryFactCost" DECIMAL(18,2),
ADD COLUMN     "deliveryKind" TEXT,
ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "deliveryProvider" TEXT,
ADD COLUMN     "recheck" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SupplyRequestItem" ADD COLUMN     "prevPrice" DECIMAL(18,2);
