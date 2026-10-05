-- Kirim QQS (NDS 12%): kompaniya va yetkazuvchi QQS to'lovchisi belgisi, kirim qatorida QQS stavkasi va summasi.
--
-- Ma'lumot saqlanadi va jimgina o'zgarmaydi:
--  · mavjud kirim qatorlari vatRate = 0, vatAmount = 0 oladi — ularning to'lanadigan summasi (qty × price),
--    yetkazuvchi qarzi, to'lov qoldig'i va sklad tannarxi (StockMove.unitCost) avvalgidek qoladi;
--  · CompanySettings.vatPayer va Supplier.vatPayer standart true — YANGI kirimlar ilova tomonidan
--    yetkazuvchiga qarab 12% (yoki 0%) QQS bilan yoziladi (`lib/receipt-vat.ts`).

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "vatPayer" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "GoodsReceiptItem" ADD COLUMN     "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "vatPayer" BOOLEAN NOT NULL DEFAULT true;

-- Stavka faqat 0 yoki 12, QQS summasi manfiy bo'lmaydi (Prisma CHECK'ni kuzatmaydi — sxema farqi chiqmaydi)
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_vatRate_check" CHECK ("vatRate" IN (0, 12));
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_vatAmount_check" CHECK ("vatAmount" >= 0);
