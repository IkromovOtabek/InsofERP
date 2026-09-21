-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPERVISOR';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "hiredAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "WorkPosition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isDriver" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkPosition_name_key" ON "WorkPosition"("name");

-- Ishchi lavozimlar ro'yxati (eski kodda qattiq yozilgan 5 tasi + otdel kadr uchun yangilari)
INSERT INTO "WorkPosition" ("id", "name", "note", "isDriver", "sortOrder", "updatedAt") VALUES
  ('wp_haydovchi',  'Haydovchi',            'Mikser / yuk mashinasi — haydovchi ilovasiga chiqadi', true,  10, CURRENT_TIMESTAMP),
  ('wp_operator',   'Operator',             'BSU operatori — zames beradi',                         false, 20, CURRENT_TIMESTAMP),
  ('wp_laborant',   'Laborant',             'Beton sinovi, kub namunalari',                         false, 30, CURRENT_TIMESTAMP),
  ('wp_skladchi',   'Skladchi',             'Xomashyo qabuli va chiqimi',                           false, 40, CURRENT_TIMESTAMP),
  ('wp_master',     'Master',               'Smena ustasi',                                         false, 50, CURRENT_TIMESTAMP),
  ('wp_mexanik',    'Mexanik',              'Texnika ta''miri va profilaktikasi',                   false, 60, CURRENT_TIMESTAMP),
  ('wp_elektrik',   'Elektrik',             'Elektr jihozlari',                                     false, 70, CURRENT_TIMESTAMP),
  ('wp_payvandchi', 'Payvandchi',           NULL,                                                   false, 80, CURRENT_TIMESTAMP),
  ('wp_ekskavator', 'Ekskavator operatori', NULL,                                                   false, 90, CURRENT_TIMESTAMP),
  ('wp_pogruzchik', 'Pogruzchik operatori', 'Xomashyo yuklash',                                     false, 100, CURRENT_TIMESTAMP),
  ('wp_kran',       'Kran operatori',       NULL,                                                   false, 110, CURRENT_TIMESTAMP),
  ('wp_betonchi',   'Betonchi',             NULL,                                                   false, 120, CURRENT_TIMESTAMP),
  ('wp_armatura',   'Armaturachi',          NULL,                                                   false, 130, CURRENT_TIMESTAMP),
  ('wp_qolipchi',   'Qolipchi',             'Dona mahsulot qoliplari',                              false, 140, CURRENT_TIMESTAMP),
  ('wp_yukortuvchi','Yuk ortuvchi',         NULL,                                                   false, 150, CURRENT_TIMESTAMP),
  ('wp_slesar',     'Slesar / ta''mirchi',  NULL,                                                   false, 160, CURRENT_TIMESTAMP),
  ('wp_qoriqchi',   'Qo''riqchi',           'Smenali navbatchilik',                                 false, 170, CURRENT_TIMESTAMP),
  ('wp_farrosh',    'Farrosh',              NULL,                                                   false, 180, CURRENT_TIMESTAMP),
  ('wp_oshpaz',     'Oshpaz',               NULL,                                                   false, 190, CURRENT_TIMESTAMP),
  ('wp_kotib',      'Kotib',                'Hujjat aylanishi',                                     false, 200, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Bazada allaqachon ishlatilayotgan, lekin ro'yxatda yo'q ishchi lavozimlar ham tushsin
INSERT INTO "WorkPosition" ("id", "name", "sortOrder", "updatedAt")
SELECT md5(e."position"), e."position", 500, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "position" FROM "Employee") e
WHERE e."position" NOT IN (SELECT "name" FROM "WorkPosition")
  AND e."position" NOT IN ('Sotuv','Ishlab chiqarish','Logistika','Buxgalteriya','Finance','Otdel kadr','Sklad','Snabjeniye','Kassa / bank','Direktor','Ish boshqaruvchi')
ON CONFLICT ("name") DO NOTHING;
