-- Raqamsiz ijara shartnomalariga avtomatik raqam: IJ-<boshlanish yili>-00001 (yil ichida boshlanish sanasi tartibida,
-- shu yilda mavjud eng katta IJ raqamidan keyin). Sxema o'zgarmaydi — faqat ma'lumot.
WITH mx AS (
  SELECT substring("no" from '^IJ-(\d{4})-\d+$')::int AS y, max(substring("no" from '^IJ-\d{4}-(\d+)$')::int) AS m
  FROM "RentLease" WHERE "no" ~ '^IJ-\d{4}-\d+$' GROUP BY 1
), n AS (
  SELECT l."id", EXTRACT(YEAR FROM l."startDate")::int AS y,
         row_number() OVER (PARTITION BY EXTRACT(YEAR FROM l."startDate") ORDER BY l."startDate", l."createdAt", l."id") AS rn
  FROM "RentLease" l WHERE l."no" IS NULL OR btrim(l."no") = ''
)
UPDATE "RentLease" r
SET "no" = 'IJ-' || n.y || '-' || lpad((n.rn + COALESCE(mx.m, 0))::text, 5, '0')
FROM n LEFT JOIN mx ON mx.y = n.y
WHERE r."id" = n."id";
