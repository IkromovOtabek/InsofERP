-- "Mexanik" endi bo'lim lavozimi (MECHANIC roli, login oladi) — shu nomdagi ishchi lavozim
-- ikkinchi marta tanlovda chiqmasin: o'chiriladi (xodimlarning position matni o'zgarmaydi).
UPDATE "WorkPosition" SET "isActive" = false, "updatedAt" = NOW() WHERE lower(trim("name")) = 'mexanik';
