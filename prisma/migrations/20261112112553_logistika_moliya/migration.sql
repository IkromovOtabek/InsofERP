-- AlterTable
ALTER TABLE "LogisticsEntry" ADD COLUMN     "payLogiTxId" TEXT;

-- AlterTable
ALTER TABLE "MechanicRequest" ADD COLUMN     "logisticsTxId" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "payLogiTxId" TEXT;

-- CreateTable
CREATE TABLE "LogisticsAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CashAccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogisticsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsTx" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "CashTxType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "category" TEXT NOT NULL,
    "accountId" TEXT,
    "cashTxId" TEXT,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "counterparty" TEXT,
    "note" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "clientToken" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "LogisticsTx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsAccount_name_type_key" ON "LogisticsAccount"("name", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsTx_docNo_key" ON "LogisticsTx"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsTx_cashTxId_key" ON "LogisticsTx"("cashTxId");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsTx_clientToken_key" ON "LogisticsTx"("clientToken");

-- CreateIndex
CREATE INDEX "LogisticsTx_date_idx" ON "LogisticsTx"("date");

-- CreateIndex
CREATE INDEX "LogisticsTx_accountId_idx" ON "LogisticsTx"("accountId");

-- CreateIndex
CREATE INDEX "LogisticsTx_refType_refId_idx" ON "LogisticsTx"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "MechanicRequest_logisticsTxId_key" ON "MechanicRequest"("logisticsTxId");

-- AddForeignKey
ALTER TABLE "LogisticsTx" ADD CONSTRAINT "LogisticsTx_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LogisticsAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Sukut logistika hisobi (Logistika moliya → naqd)
INSERT INTO "LogisticsAccount" ("id", "name", "type") VALUES ('logi_kassa_naqd', 'Logistika kassasi', 'CASH') ON CONFLICT DO NOTHING;
