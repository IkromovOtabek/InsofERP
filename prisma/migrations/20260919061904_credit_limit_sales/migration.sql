-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "creditLimit" SET DEFAULT 100000000;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Barcha mavjud mijozlarga 100 mln standart limit (talab: har bir mijozga 100 mln ajratiladi)
UPDATE "Customer" SET "creditLimit" = 100000000;

-- Eski kirimlar uchun "kim kiritdi" ni StockMove jurnalidan tiklaymiz
UPDATE "GoodsReceipt" g
SET "createdById" = (
  SELECT m."createdById" FROM "StockMove" m
  WHERE m."refType" = 'GoodsReceipt' AND m."refId" = g."id"
  ORDER BY m."createdAt" ASC LIMIT 1
);
