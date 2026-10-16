-- CreateEnum
CREATE TYPE "RentTxType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "RentMethod" AS ENUM ('CASH', 'BANK');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SECRETARY';

-- CreateTable
CREATE TABLE "RentShop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "bankAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "electricity" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentCharge" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "bankDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "electricity" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentTx" (
    "id" TEXT NOT NULL,
    "type" "RentTxType" NOT NULL,
    "method" "RentMethod" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "month" DATE,
    "shopId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientToken" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "RentTx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentShop_location_name_key" ON "RentShop"("location", "name");

-- CreateIndex
CREATE INDEX "RentCharge_month_idx" ON "RentCharge"("month");

-- CreateIndex
CREATE UNIQUE INDEX "RentCharge_shopId_month_key" ON "RentCharge"("shopId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "RentTx_clientToken_key" ON "RentTx"("clientToken");

-- CreateIndex
CREATE INDEX "RentTx_month_shopId_idx" ON "RentTx"("month", "shopId");

-- CreateIndex
CREATE INDEX "RentTx_date_idx" ON "RentTx"("date");

-- AddForeignKey
ALTER TABLE "RentCharge" ADD CONSTRAINT "RentCharge_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "RentShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentTx" ADD CONSTRAINT "RentTx_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "RentShop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentTx" ADD CONSTRAINT "RentTx_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

