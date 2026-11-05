-- CreateTable
CREATE TABLE "RealizationEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "payGroup" TEXT NOT NULL,
    "seller" TEXT,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "ttn" TEXT,
    "vehicle" TEXT,
    "unit" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "delivery" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "loadPlace" TEXT,
    "destination" TEXT,
    "note" TEXT,
    "refName" TEXT,
    "clientToken" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "RealizationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealizationNote" (
    "key" TEXT NOT NULL,
    "loadPlace" TEXT,
    "destination" TEXT,
    "note" TEXT,
    "refName" TEXT,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealizationNote_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "RealizationEntry_clientToken_key" ON "RealizationEntry"("clientToken");

-- CreateIndex
CREATE INDEX "RealizationEntry_date_idx" ON "RealizationEntry"("date");

-- AddForeignKey
ALTER TABLE "RealizationEntry" ADD CONSTRAINT "RealizationEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealizationEntry" ADD CONSTRAINT "RealizationEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealizationEntry" ADD CONSTRAINT "RealizationEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

