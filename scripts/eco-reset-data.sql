-- Insof ECO (haydovchi ilovasi) bazasini tozalash.
--
-- Barcha biznes ma'lumoti o'chadi: buyurtma, yetkazib berish, GPS nuqtalar,
-- schyot, to'lov, xarajat, xabar, loyiha, vazifa, sklad, texnika, mijoz
-- tashkilotlari, foydalanuvchilar (haydovchi/mijoz/ishchi), sessiyalar.
--
-- Saqlanadi — faqat integratsiya ishlab turishi uchun:
--   · IntegrationClient (ERP X-Api-Key) va u bog'langan Organization (zavod)
--   · shu kalitning xizmat foydalanuvchisi va uning a'zoligi
-- Shu sababli ERP dagi ECO_API_KEY o'zgarmaydi, qayta integration:create shart emas.
--
-- Ishga tushirish (VPS, deploy foydalanuvchisi ostida):
--   docker exec -i insof-eco-prod-postgres-1 psql -U insof -d insof -v ON_ERROR_STOP=1 \
--     < /var/www/insof-erp/scripts/eco-reset-data.sql
--
-- Faqat `public` sxemasiga tegadi: ERP bazasi shu Postgres ichida `erp` sxemasida
-- bo'lsa ham, u bu skriptdan zarar ko'rmaydi (uni reset-data.ts tozalaydi).
--
-- Foydalanuvchi/baza nomi boshqa bo'lsa: /var/www/insof-eco/apps/api/.env dagi
-- POSTGRES_USER / POSTGRES_DB ga qarang. Konteyner nomi: docker ps --format '{{.Names}}'.

\echo '--- oldingi holat ---'
SELECT
  (SELECT count(*) FROM "Organization")      AS tashkilot,
  (SELECT count(*) FROM "User")              AS foydalanuvchi,
  (SELECT count(*) FROM "Order")             AS buyurtma,
  (SELECT count(*) FROM "Delivery")          AS yetkazish,
  (SELECT count(*) FROM "GpsPoint")          AS gps,
  (SELECT count(*) FROM "IntegrationClient") AS kalit;

BEGIN;

-- Kalit bilan bog'liq bo'lmagan hamma jadval tozalanadi.
-- CASCADE ataylab ishlatilmadi: saqlanadigan jadvaldan tozalanadiganga
-- havola bo'lsa, PostgreSQL jimgina o'chirmasdan xato beradi.
DO $$
DECLARE list text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO list
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename NOT IN (
       '_prisma_migrations', 'spatial_ref_sys',
       'User', 'Organization', 'IntegrationClient', 'Membership'
     );
  IF list IS NULL THEN
    RAISE EXCEPTION 'public sxemasida jadval topilmadi — baza to''g''rimi?';
  END IF;
  EXECUTE 'TRUNCATE TABLE ' || list || ' RESTART IDENTITY';
END $$;

-- Integratsiya kalitiga tegishli bo'lmagan a'zolik, foydalanuvchi va tashkilotlar.
DELETE FROM "Membership" m
 WHERE NOT EXISTS (
   SELECT 1 FROM "IntegrationClient" ic
    WHERE ic."userId" = m."userId" AND ic."organizationId" = m."organizationId"
 );

DELETE FROM "User" u
 WHERE NOT EXISTS (SELECT 1 FROM "IntegrationClient" ic WHERE ic."userId" = u.id);

DELETE FROM "Organization" o
 WHERE NOT EXISTS (SELECT 1 FROM "IntegrationClient" ic WHERE ic."organizationId" = o.id);

COMMIT;

\echo '--- yangi holat ---'
SELECT
  (SELECT count(*) FROM "Organization")      AS tashkilot,
  (SELECT count(*) FROM "User")              AS foydalanuvchi,
  (SELECT count(*) FROM "Order")             AS buyurtma,
  (SELECT count(*) FROM "Delivery")          AS yetkazish,
  (SELECT count(*) FROM "GpsPoint")          AS gps,
  (SELECT count(*) FROM "IntegrationClient") AS kalit;

\echo 'Saqlangan tashkilot va kalit:'
SELECT o.name AS tashkilot, o.inn, ic.name AS kalit, ic."keyPrefix", u.phone AS xizmat_foydalanuvchi
  FROM "IntegrationClient" ic
  JOIN "Organization" o ON o.id = ic."organizationId"
  JOIN "User" u ON u.id = ic."userId";
