-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "realizationAutoConsume" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "realizationStockFrom" TIMESTAMP(3);


-- Reyssiz sotuv skladdan 2026-11-25 (Toshkent yarim tuni = 2026-11-24 19:00 UTC) dan chiqadi — noyabr tarixi orqaga yozilmaydi
UPDATE "CompanySettings" SET "realizationStockFrom" = '2026-11-24 19:00:00' WHERE "realizationStockFrom" IS NULL;
