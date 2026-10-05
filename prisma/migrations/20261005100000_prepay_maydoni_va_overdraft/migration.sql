-- Zayavkaning kutilayotgan bosh to'lovi alohida ustunda (ilgari izoh matnidan o'qilardi) va
-- kassa/bank hisobi uchun "overdraft ruxsat" belgisi.

-- AlterTable
ALTER TABLE "CashAccount" ADD COLUMN     "allowOverdraft" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "prepayAmount" DECIMAL(18,2);

-- Backfill: izohdagi "Kutilayotgan avans: 1 250 000 so'm" qatoridan summa olinadi, qator izohdan olib tashlanadi
-- (summa endi ustunda; izohda qolsa zayavka sahifasida ikki marta ko'rinardi).
UPDATE "Order"
SET "prepayAmount" = NULLIF(regexp_replace(substring("note" from 'Kutilayotgan avans:\s*([0-9 ]+)\s*so''m'), '\s', '', 'g'), '')::numeric,
    "note" = NULLIF(btrim(regexp_replace("note", 'Kutilayotgan avans:\s*[0-9 ]+\s*so''m\n?', ''), E' \n'), '')
WHERE "note" ~ 'Kutilayotgan avans:\s*[0-9]';

-- Hozir minusda turgan bank hisoblari ishlashda davom etsin: ular uchun overdraft ochiq qoladi
-- (direktor Sozlamalarda o'chirishi mumkin). Qolgan hisoblar endi minusga tushmaydi.
UPDATE "CashAccount" a SET "allowOverdraft" = true
WHERE a."type" = 'BANK' AND (
  COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."cashAccountId" = a."id"), 0)
  + COALESCE((SELECT SUM(CASE WHEN t."type" = 'EXPENSE' THEN -t."amount" ELSE t."amount" END) FROM "CashTransaction" t WHERE t."cashAccountId" = a."id"), 0)
) < 0;
