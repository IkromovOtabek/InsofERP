-- CreateTable
CREATE TABLE "SalesRegister" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleNo" TEXT,
    "ttn" TEXT,
    "productName" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'm3',
    "qty" DECIMAL(18,3) NOT NULL,
    "fromWho" TEXT,
    "payType" TEXT,
    "deliveryFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sum" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "nds" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "address" TEXT,
    "contractNo" TEXT,
    "invoiceNo" TEXT,
    "monthNo" TEXT,
    "note" TEXT,
    "cashAccountId" TEXT,
    "paymentId" TEXT,
    "batch" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRegister_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesRegister_paymentId_key" ON "SalesRegister"("paymentId");

-- CreateIndex
CREATE INDEX "SalesRegister_customerId_idx" ON "SalesRegister"("customerId");

-- CreateIndex
CREATE INDEX "SalesRegister_date_idx" ON "SalesRegister"("date");

-- CreateIndex
CREATE INDEX "SalesRegister_batch_idx" ON "SalesRegister"("batch");

-- AddForeignKey
ALTER TABLE "SalesRegister" ADD CONSTRAINT "SalesRegister_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRegister" ADD CONSTRAINT "SalesRegister_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRegister" ADD CONSTRAINT "SalesRegister_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRegister" ADD CONSTRAINT "SalesRegister_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
