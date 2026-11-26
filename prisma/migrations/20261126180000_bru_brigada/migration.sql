-- AlterTable
ALTER TABLE "Brigade" ADD COLUMN     "isBru" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "bruId" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "bruId" TEXT;

-- CreateIndex
CREATE INDEX "OrderItem_bruId_idx" ON "OrderItem"("bruId");

-- CreateIndex
CREATE INDEX "Trip_bruId_idx" ON "Trip"("bruId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_bruId_fkey" FOREIGN KEY ("bruId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_bruId_fkey" FOREIGN KEY ("bruId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- BRU — Otdel kadr → «Komanda va brigadalar» dagi BRU komandalari (BRU-1, BRU-2…; nomi BRU/БРУ bilan boshlanadi).
-- Ular BRU brigadasiga aylanadi: beton m³ (sdelka) shu brigada varag'iga tushadi, a'zolarning oklad/stavkasi o'zgarmaydi —
-- varaq puli ustiga qo'shiladi (lib/hr/payroll.ts). Logistika sozlamalaridagi eski BRU nomlaridan (operator ismlari) brigada ochilmaydi.
CREATE TEMP TABLE _bru_team AS
SELECT t.id AS team_id, COALESCE(b.id, 'bru' || substr(md5(t.id), 1, 22)) AS brigade_id, b.id IS NOT NULL AS existed,
       t.name, t."leaderId", t.phone, t.note
  FROM "Team" t
  LEFT JOIN "Brigade" b ON lower(trim(b.name)) = lower(trim(t.name))
 WHERE t."isActive" AND trim(t.name) ~* '^(bru|бру)';

-- Nomi bir xil brigada bo'lsa — o'sha BRU deb belgilanadi, yo'q bo'lsa ochiladi
UPDATE "Brigade" b SET "isBru" = true, "isActive" = true FROM _bru_team x WHERE x.existed AND b.id = x.brigade_id;

INSERT INTO "Brigade" (id, name, "leaderId", phone, note, "isBru", "isActive", aliases, "createdAt")
SELECT brigade_id, trim(name), "leaderId", phone, note, true, true, '{}', now() FROM _bru_team WHERE NOT existed;

-- A'zolar komandadan BRU brigadasiga (boshqa brigadaga biriktirilganlari tegilmaydi)
UPDATE "Employee" e SET "brigadeId" = x.brigade_id, "teamId" = NULL
  FROM _bru_team x WHERE e."teamId" = x.team_id AND e."brigadeId" IS NULL;

-- Komanda yopiladi (kassadagi eski yozuvlari o'z joyida qoladi)
UPDATE "Team" t SET "isActive" = false FROM _bru_team x WHERE t.id = x.team_id;

-- Eski reyslar: BRU nomi BRU brigadasi nomiga mos bo'lsa bog'lanadi («BRU 1» = «BRU-1» — faqat harf va raqam solishtiriladi)
UPDATE "Trip" t SET "bruId" = b.id
  FROM "Brigade" b
 WHERE t.bru IS NOT NULL AND b."isBru"
   AND regexp_replace(lower(t.bru), '[^[:alnum:]]', '', 'g') = regexp_replace(lower(b.name), '[^[:alnum:]]', '', 'g');

DROP TABLE _bru_team;
