-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "rentRemindDay" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "RentShop" ADD COLUMN     "inn" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "tenantName" TEXT,
ADD COLUMN     "tgChatId" TEXT,
ADD COLUMN     "tgLinkToken" TEXT,
ADD COLUMN     "tgLinkedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RentReminder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "debt" DECIMAL(18,2) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentReminder_shopId_createdAt_idx" ON "RentReminder"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "RentReminder_month_auto_idx" ON "RentReminder"("month", "auto");

-- CreateIndex
CREATE UNIQUE INDEX "RentShop_tgLinkToken_key" ON "RentShop"("tgLinkToken");

-- CreateIndex
CREATE INDEX "RentShop_tgChatId_idx" ON "RentShop"("tgChatId");

-- AddForeignKey
ALTER TABLE "RentReminder" ADD CONSTRAINT "RentReminder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "RentShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

