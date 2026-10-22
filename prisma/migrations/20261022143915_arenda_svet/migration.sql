-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "rentElecMarkup" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RentCharge" ADD COLUMN     "elecFixed" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "elecNote" TEXT,
ADD COLUMN     "elecPaidDirect" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RentShop" ADD COLUMN     "elecFixed" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RentElecBill" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentElecBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentElecBill_location_month_key" ON "RentElecBill"("location", "month");

