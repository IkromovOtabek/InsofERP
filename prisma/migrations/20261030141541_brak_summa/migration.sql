-- AlterTable
ALTER TABLE "ProductDefect" ADD COLUMN     "amount" DECIMAL(18,2) NOT NULL DEFAULT 0;


-- Mavjud brak yozuvlari: miqdor × mahsulot sotuv narxi
UPDATE "ProductDefect" d SET "amount" = ROUND(d."qty" * p."price", 2) FROM "Product" p WHERE p."id" = d."productId";
