-- Brigada tayinlash endi zayavka qatorida va faqat Ishlab chiqarish bo'limida tasdiqlanganda topshiriq yaratiladi.
-- Eski oqimda qoralama (DRAFT) zayavka uchun yaratilgan topshiriqlar olib tashlanadi (TaskProgress cascade bilan).
DELETE FROM "BrigadeTask" WHERE "orderId" IN (SELECT id FROM "Order" WHERE status = 'DRAFT');
UPDATE "OrderItem" SET "brigadeId" = NULL WHERE "orderId" IN (SELECT id FROM "Order" WHERE status = 'DRAFT');

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_brigadeId_fkey";

-- DropColumn
ALTER TABLE "Order" DROP COLUMN "brigadeId";
