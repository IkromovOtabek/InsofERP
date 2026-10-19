-- CreateEnum
CREATE TYPE "RentPeriod" AS ENUM ('MONTHLY', 'DAILY');

-- AlterTable
ALTER TABLE "RentCharge" ADD COLUMN     "days" INTEGER;

-- AlterTable
ALTER TABLE "RentShop" ADD COLUMN     "period" "RentPeriod" NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "RentTx" ADD COLUMN     "day" DATE;

-- CreateIndex
CREATE INDEX "RentTx_shopId_day_idx" ON "RentTx"("shopId", "day");

