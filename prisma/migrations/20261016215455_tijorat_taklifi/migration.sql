-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "offerIntro" TEXT,
ADD COLUMN     "offerTerms" TEXT,
ADD COLUMN     "offerValidDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "oked" TEXT,
ADD COLUMN     "vatRegNo" TEXT;

-- CreateTable
CREATE TABLE "CommercialOffer" (
    "id" TEXT NOT NULL,
    "offerNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "lang" TEXT NOT NULL DEFAULT 'uz',
    "customerId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientInn" TEXT,
    "objectName" TEXT,
    "deadline" TEXT,
    "withVat" BOOLEAN NOT NULL DEFAULT true,
    "advance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "intro" TEXT,
    "terms" TEXT,
    "note" TEXT,
    "managerId" TEXT NOT NULL,
    "orderId" TEXT,
    "leadId" TEXT,
    "verifyToken" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "acceptedNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialOfferItem" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'dona',
    "qty" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CommercialOfferItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialOffer_offerNo_key" ON "CommercialOffer"("offerNo");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialOffer_verifyToken_key" ON "CommercialOffer"("verifyToken");

-- CreateIndex
CREATE INDEX "CommercialOffer_status_date_idx" ON "CommercialOffer"("status", "date");

-- CreateIndex
CREATE INDEX "CommercialOffer_customerId_idx" ON "CommercialOffer"("customerId");

-- CreateIndex
CREATE INDEX "CommercialOffer_managerId_idx" ON "CommercialOffer"("managerId");

-- CreateIndex
CREATE INDEX "CommercialOffer_orderId_idx" ON "CommercialOffer"("orderId");

-- CreateIndex
CREATE INDEX "CommercialOfferItem_offerId_idx" ON "CommercialOfferItem"("offerId");

-- CreateIndex
CREATE INDEX "CommercialOfferItem_productId_idx" ON "CommercialOfferItem"("productId");

-- AddForeignKey
ALTER TABLE "CommercialOffer" ADD CONSTRAINT "CommercialOffer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOffer" ADD CONSTRAINT "CommercialOffer_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOffer" ADD CONSTRAINT "CommercialOffer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOffer" ADD CONSTRAINT "CommercialOffer_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOfferItem" ADD CONSTRAINT "CommercialOfferItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CommercialOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOfferItem" ADD CONSTRAINT "CommercialOfferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

