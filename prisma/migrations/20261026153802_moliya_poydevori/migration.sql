-- CreateEnum
CREATE TYPE "CashFlowKind" AS ENUM ('OPERATING', 'FINANCING', 'INVESTING');

-- CreateEnum
CREATE TYPE "PnlLine" AS ENUM ('OTHER_INCOME', 'MATERIALS', 'PRODUCTION', 'PAYROLL', 'TRANSPORT', 'ADMIN', 'COMMERCIAL', 'TAX', 'INTEREST', 'PROJECT', 'DIVIDEND', 'NONE');

-- CreateEnum
CREATE TYPE "CashCategoryNeeds" AS ENUM ('PROJECT', 'LOAN', 'ASSET');

-- CreateEnum
CREATE TYPE "LoanKind" AS ENUM ('BANK', 'BORROWED', 'LENT');

-- CreateEnum
CREATE TYPE "LoanPart" AS ENUM ('PRINCIPAL', 'INTEREST');

-- AlterTable
ALTER TABLE "CashTransaction" ADD COLUMN     "loanId" TEXT,
ADD COLUMN     "loanPart" "LoanPart",
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "subCategory" TEXT;

-- CreateTable
CREATE TABLE "CashCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CashTxType" NOT NULL,
    "parentId" TEXT,
    "flow" "CashFlowKind" NOT NULL DEFAULT 'OPERATING',
    "pnlLine" "PnlLine" NOT NULL DEFAULT 'NONE',
    "needs" "CashCategoryNeeds",
    "loanPart" "LoanPart",
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "kind" "LoanKind" NOT NULL,
    "name" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openingDate" TIMESTAMP(3) NOT NULL,
    "rate" DECIMAL(6,2),
    "note" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "lifeMonths" INTEGER NOT NULL,
    "cashTxId" TEXT,
    "note" TEXT,
    "disposedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashCategory_name_key" ON "CashCategory"("name");

-- CreateIndex
CREATE INDEX "CashCategory_parentId_idx" ON "CashCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE INDEX "Loan_kind_cancelledAt_idx" ON "Loan"("kind", "cancelledAt");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_cashTxId_key" ON "FixedAsset"("cashTxId");

-- CreateIndex
CREATE INDEX "FixedAsset_cancelledAt_idx" ON "FixedAsset"("cancelledAt");

-- CreateIndex
CREATE INDEX "CashTransaction_projectId_idx" ON "CashTransaction"("projectId");

-- CreateIndex
CREATE INDEX "CashTransaction_loanId_idx" ON "CashTransaction"("loanId");

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCategory" ADD CONSTRAINT "CashCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CashCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_cashTxId_fkey" FOREIGN KEY ("cashTxId") REFERENCES "CashTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Boshlang'ich kategoriyalar daraxti (Manba → Sub manba). Nomlar lib/cash-categories.ts dagi mavjud ro'yxat bilan bir xil:
-- avtomatik yozadigan joylar va eski yozuvlar nom bo'yicha bog'lanadi. Eski erkin nomlar — aliases.
INSERT INTO "CashCategory" ("id","name","type","parentId","flow","pnlLine","needs","loanPart","aliases","isSystem","sort","updatedAt") VALUES
  ('cc_xomashyo',   'Xomashyo',                     'EXPENSE', NULL, 'OPERATING', 'MATERIALS',  NULL, NULL, ARRAY['xom-ashyo','tannarx( tavarga to''lov)','tovarga to''lov']::TEXT[], true, 10, NOW()),
  ('cc_ishhaqi',    'Ish haqi',                     'EXPENSE', NULL, 'OPERATING', 'PAYROLL',    NULL, NULL, ARRAY['oylik','maosh','xodimlar maoshlari']::TEXT[], true, 20, NOW()),
  ('cc_pitaniya',   'Pitaniya',                     'EXPENSE', NULL, 'OPERATING', 'PRODUCTION', NULL, NULL, ARRAY['ovqat','ovqatlanish','pitanie','obed','oziq-ovqat xarajatlari','oziq-ovqat']::TEXT[], true, 30, NOW()),
  ('cc_transport',  'Transport',                    'EXPENSE', NULL, 'OPERATING', 'TRANSPORT',  NULL, NULL, ARRAY['transport / yoqilg''i','avtotransport']::TEXT[], true, 40, NOW()),
  ('cc_tamir',      'Ta''mirlash / ehtiyot qism',   'EXPENSE', NULL, 'OPERATING', 'PRODUCTION', NULL, NULL, ARRAY['ta''mir','ta''mirlash','ehtiyot qism','zapchast','zavod xarajatlari']::TEXT[], true, 50, NOW()),
  ('cc_kommunal',   'Kommunal (elektr, suv, gaz)',  'EXPENSE', NULL, 'OPERATING', 'PRODUCTION', NULL, NULL, ARRAY['kommunal','komunal to''lovlari (suv, svet, gaz)']::TEXT[], true, 60, NOW()),
  ('cc_ijara',      'Ijara',                        'EXPENSE', NULL, 'OPERATING', 'PRODUCTION', NULL, NULL, ARRAY[]::TEXT[], true, 70, NOW()),
  ('cc_soliq',      'Soliq va to''lovlar',          'EXPENSE', NULL, 'OPERATING', 'TAX',        NULL, NULL, ARRAY['soliq','soliqlar']::TEXT[], true, 80, NOW()),
  ('cc_marketing',  'Marketing',                    'EXPENSE', NULL, 'OPERATING', 'COMMERCIAL', NULL, NULL, ARRAY['reklama','marketing xarajatlari']::TEXT[], true, 90, NOW()),
  ('cc_ofis',       'Ofis / xo''jalik',             'EXPENSE', NULL, 'OPERATING', 'ADMIN',      NULL, NULL, ARRAY['ofis','ofis xarajatlari','hr xarajati']::TEXT[], true, 100, NOW()),
  ('cc_bank',       'Bank xizmati',                 'EXPENSE', NULL, 'OPERATING', 'ADMIN',      NULL, NULL, ARRAY['kurs farqi']::TEXT[], true, 110, NOW()),
  ('cc_boshqa_ch',  'Boshqa chiqim',                'EXPENSE', NULL, 'OPERATING', 'PRODUCTION', NULL, NULL, ARRAY['boshqa nakladnoy xarajatlar']::TEXT[], true, 120, NOW()),
  ('cc_kredit_tana','Kredit — asosiy qarz',         'EXPENSE', NULL, 'FINANCING', 'NONE',       'LOAN', 'PRINCIPAL', ARRAY['kredit asosiy qarz','kridit asosiy karz','qarz qaytarildi']::TEXT[], true, 200, NOW()),
  ('cc_kredit_foiz','Kredit foizi',                 'EXPENSE', NULL, 'FINANCING', 'INTEREST',   'LOAN', 'INTEREST',  ARRAY['kridit foizi','kredit va kredit foizi','kridit va kridit foizi']::TEXT[], true, 210, NOW()),
  ('cc_qarz_berish','Qarz berildi',                 'EXPENSE', NULL, 'FINANCING', 'NONE',       'LOAN', 'PRINCIPAL', ARRAY[]::TEXT[], true, 220, NOW()),
  ('cc_divident',   'Divident',                     'EXPENSE', NULL, 'FINANCING', 'DIVIDEND',   NULL, NULL, ARRAY['dividend','egasiga']::TEXT[], true, 230, NOW()),
  ('cc_vosita',     'Asosiy vosita xaridi',         'EXPENSE', NULL, 'INVESTING', 'NONE',       'ASSET', NULL, ARRAY['asosiy vosita sotib olish','reinvistitsiya','reinvestitsiya']::TEXT[], true, 300, NOW()),
  ('cc_loyiha',     'Loyihalar',                    'EXPENSE', NULL, 'INVESTING', 'PROJECT',    'PROJECT', NULL, ARRAY['loyiha']::TEXT[], true, 310, NOW()),
  ('cc_boshqa_tush','Boshqa tushum',                'INCOME',  NULL, 'OPERATING', 'OTHER_INCOME', NULL, NULL, ARRAY['boshqa tushumlar','chakana savdo']::TEXT[], true, 10, NOW()),
  ('cc_xizmat',     'Xizmat (nasos, transport)',    'INCOME',  NULL, 'OPERATING', 'OTHER_INCOME', NULL, NULL, ARRAY[]::TEXT[], true, 20, NOW()),
  ('cc_chiqindi',   'Chiqindi / brak sotuvi',       'INCOME',  NULL, 'OPERATING', 'OTHER_INCOME', NULL, NULL, ARRAY['metallom']::TEXT[], true, 30, NOW()),
  ('cc_avans_qayt', 'Qaytarilgan avans',            'INCOME',  NULL, 'OPERATING', 'NONE',         NULL, NULL, ARRAY[]::TEXT[], true, 40, NOW()),
  ('cc_tasischi',   'Ta''sischi kiritmasi',         'INCOME',  NULL, 'FINANCING', 'NONE',         NULL, NULL, ARRAY['ustav kapital','boshlang''ich qoldiq','kapital']::TEXT[], true, 50, NOW()),
  ('cc_kredit_ol',  'Kredit / qarz olindi',         'INCOME',  NULL, 'FINANCING', 'NONE',         'LOAN', 'PRINCIPAL', ARRAY['qarz olindi','kredit olindi']::TEXT[], true, 60, NOW()),
  ('cc_qarz_qayt',  'Berilgan qarz qaytdi',         'INCOME',  NULL, 'FINANCING', 'NONE',         'LOAN', 'PRINCIPAL', ARRAY['qarz qaytdi']::TEXT[], true, 70, NOW())
ON CONFLICT ("name") DO NOTHING;

-- Sub manbalar (jadvaldagi «Sub manba» ro'yxatidan). Bola ota-onaning oqim turi va PNL qatorini oladi.
INSERT INTO "CashCategory" ("id","name","type","parentId","flow","pnlLine","aliases","sort","updatedAt") VALUES
  ('cc_t_yoqilgi', 'Yoqilg''i',                    'EXPENSE', 'cc_transport', 'OPERATING', 'TRANSPORT', ARRAY['yoqilgi','benzin','dizel','solyarka','salyarka','yoqilg''i xarajatlari']::TEXT[], 1, NOW()),
  ('cc_t_remont',  'Transport ta''miri va zapchast','EXPENSE', 'cc_transport', 'OPERATING', 'TRANSPORT', ARRAY['remont xarajatlari','avto zapchast','vulkanizatsiya']::TEXT[], 2, NOW()),
  ('cc_t_yollanma','Yollanma texnika',             'EXPENSE', 'cc_transport', 'OPERATING', 'TRANSPORT', ARRAY['texnika xarajatlari','usluga']::TEXT[], 3, NOW()),
  ('cc_t_yol',     'Yo''l kira, shtraf, sug''urta','EXPENSE', 'cc_transport', 'OPERATING', 'TRANSPORT', ARRAY['yo''l kra xarajatlari','moshina shtraf va sug''urtalari']::TEXT[], 4, NOW()),
  ('cc_i_oylik',   'Oylik va avans',               'EXPENSE', 'cc_ishhaqi',   'OPERATING', 'PAYROLL',   ARRAY['avans']::TEXT[], 1, NOW()),
  ('cc_i_kunbay',  'Yollanma (kunbay) ishchilar',  'EXPENSE', 'cc_ishhaqi',   'OPERATING', 'PAYROLL',   ARRAY['yollanma xodimlarga xarajatlar','kunbay']::TEXT[], 2, NOW()),
  ('cc_k_elektr',  'Elektr',                       'EXPENSE', 'cc_kommunal',  'OPERATING', 'PRODUCTION', ARRAY['elektr energiya','svet']::TEXT[], 1, NOW()),
  ('cc_k_gaz',     'Gaz',                          'EXPENSE', 'cc_kommunal',  'OPERATING', 'PRODUCTION', ARRAY[]::TEXT[], 2, NOW()),
  ('cc_k_suv',     'Suv',                          'EXPENSE', 'cc_kommunal',  'OPERATING', 'PRODUCTION', ARRAY[]::TEXT[], 3, NOW()),
  ('cc_o_aloqa',   'Telefon va internet',          'EXPENSE', 'cc_ofis',      'OPERATING', 'ADMIN',     ARRAY['oylik abanent to''lovlari (telefon va wifi)']::TEXT[], 1, NOW()),
  ('cc_o_xojalik', 'Xo''jalik mollari',            'EXPENSE', 'cc_ofis',      'OPERATING', 'ADMIN',     ARRAY['xo''jalik']::TEXT[], 2, NOW()),
  ('cc_o_hr',      'HR (ishga olish, o''qitish)',  'EXPENSE', 'cc_ofis',      'OPERATING', 'ADMIN',     ARRAY[]::TEXT[], 3, NOW()),
  ('cc_m_xayriya', 'Xayriya va sovg''alar',        'EXPENSE', 'cc_marketing', 'OPERATING', 'COMMERCIAL', ARRAY['xayriya','sovg''a va xadyalarga xarajatlar']::TEXT[], 1, NOW())
ON CONFLICT ("name") DO NOTHING;
