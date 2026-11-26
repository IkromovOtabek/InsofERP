-- BRU — Otdel kadr → «Komanda va brigadalar» dagi BRU komandalari (BRU-1, BRU-2…; nomi BRU/БРУ bilan boshlanadi).
-- Ular BRU brigadasiga aylanadi: beton m³ (sdelka) shu brigada varag'iga tushadi, a'zolarning oklad/stavkasi o'zgarmaydi —
-- varaq puli ustiga qo'shiladi (lib/hr/payroll.ts). Sxema o'zgarmaydi, faqat ma'lumot.
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

-- Logistika sozlamalaridagi eski BRU nomlaridan (operator ismlari) ochilgan BRU lar — a'zosiz bo'lsa yopiladi (tanlovda chiqmaydi).
-- Ularga bog'langan reys/zayavka qatorlari o'z joyida qoladi — scripts/bru-reys-boglash.ts BRU-1/BRU-2 ga o'tkazadi.
UPDATE "Brigade" b SET "isActive" = false
  FROM "CompanySettings" c
 WHERE c.id = 'main' AND b."isBru" AND b."isActive"
   AND lower(trim(b.name)) IN (SELECT lower(trim(x)) FROM unnest(c."bruNames") x)
   AND b.id NOT IN (SELECT brigade_id FROM _bru_team)
   AND NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e."brigadeId" = b.id)
   AND EXISTS (SELECT 1 FROM _bru_team);

-- Eski reyslar: BRU nomi BRU brigadasi nomiga mos bo'lsa bog'lanadi («BRU 1» = «BRU-1» — faqat harf va raqam solishtiriladi)
UPDATE "Trip" t SET "bruId" = b.id
  FROM "Brigade" b
 WHERE t."bruId" IS NULL AND t.bru IS NOT NULL AND b."isBru" AND b."isActive"
   AND regexp_replace(lower(t.bru), '[^[:alnum:]]', '', 'g') = regexp_replace(lower(b.name), '[^[:alnum:]]', '', 'g');

DROP TABLE _bru_team;
