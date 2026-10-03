-- Moliya va sklad mantiqi tuzatishlari: asosiy sklad, kirim/zames storno, takroriy yuborishdan himoya,
-- "To'lanmagan kirimlar" sanasi sozlamaga, yangi mijoz kredit limiti 0.

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "payablesSince" TIMESTAMP(3);

-- AlterTable (faqat yangi mijozlar uchun standart; mavjud mijozlarning limiti o'zgarmaydi)
ALTER TABLE "Customer" ALTER COLUMN "creditLimit" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "clientToken" TEXT;

-- AlterTable
ALTER TABLE "ProductionBatch" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "StockMove" ADD COLUMN     "clientToken" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_clientToken_key" ON "GoodsReceipt"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "StockMove_clientToken_key" ON "StockMove"("clientToken");

-- Ma'lumot: faol skladlardan birinchisi (id bo'yicha — kod ham shu tartibni ishlatadi) asosiy bo'ladi
UPDATE "Warehouse" SET "isDefault" = true
WHERE "id" = (SELECT "id" FROM "Warehouse" WHERE "isActive" ORDER BY "id" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "Warehouse" WHERE "isDefault");
