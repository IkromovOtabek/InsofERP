-- Ishchi lavozim qaysi bo'lim tarkibida turadi — Otdel kadr / Bo'limlar sahifasidagi
-- tashkiliy tuzilma diagrammasi shu ustun bo'yicha chiziladi. Bo'sh bo'lsa kod nom
-- bo'yicha taxmin qiladi (src/lib/orgchart.ts), otdel kadr istalgan vaqtda o'zgartiradi.
ALTER TABLE "WorkPosition" ADD COLUMN "department" TEXT;

-- Mavjud lavozimlar joy-joyiga qo'yildi
UPDATE "WorkPosition" SET "department" = 'LOGISTICS'
 WHERE "name" IN ('Haydovchi', 'Mexanik', 'Slesar / ta''mirchi');

UPDATE "WorkPosition" SET "department" = 'PRODUCTION'
 WHERE "name" IN ('Operator', 'Laborant', 'Master', 'Prorab', 'Betonchi', 'Armaturachi', 'Qolipchi', 'Payvandchi', 'Elektrik', 'Kran operatori');

UPDATE "WorkPosition" SET "department" = 'WAREHOUSE'
 WHERE "name" IN ('Skladchi', 'Yuk ortuvchi', 'Pogruzchik operatori', 'Ekskavator operatori');

UPDATE "WorkPosition" SET "department" = 'HR'
 WHERE "name" IN ('Qo''riqchi', 'Farrosh', 'Oshpaz', 'Kotib');
