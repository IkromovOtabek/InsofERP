-- AlterTable
ALTER TABLE "RealizationNote" ADD COLUMN     "date" TIMESTAMP(3),
ADD COLUMN     "payGroup" TEXT,
ADD COLUMN     "seller" TEXT,
ADD COLUMN     "ttn" TEXT,
ADD COLUMN     "vehicle" TEXT;

-- CreateTable
CREATE TABLE "RealizationLine" (
    "key" TEXT NOT NULL,
    "productName" TEXT,
    "groupName" TEXT,
    "unit" TEXT,
    "qty" DECIMAL(18,3),
    "price" DECIMAL(18,2),
    "delivery" DECIMAL(18,2),
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealizationLine_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RealizationNote_date_idx" ON "RealizationNote"("date");

