-- CreateEnum
CREATE TYPE "CrmOptionKind" AS ENUM ('SOURCE', 'CLIENT_TYPE', 'PRODUCT', 'CHANNEL');

-- CreateEnum
CREATE TYPE "CrmClientStatus" AS ENUM ('NEW', 'CONTACTED', 'NEGOTIATION', 'ACTIVE', 'OLD', 'LOST');

-- CreateEnum
CREATE TYPE "CrmResultGroup" AS ENUM ('NO_ANSWER', 'CONTINUE', 'WAITING', 'REFUSAL', 'LOSS', 'WIN');

-- CreateEnum
CREATE TYPE "CrmNextRule" AS ENUM ('REQUIRED', 'OPTIONAL', 'NONE');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "crmActiveDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "crmColdDays" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "clientTypeId" TEXT,
ADD COLUMN     "crmAt" TIMESTAMP(3),
ADD COLUMN     "crmNote" TEXT,
ADD COLUMN     "crmStatus" "CrmClientStatus",
ADD COLUMN     "crmStatusManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "foremanName" TEXT,
ADD COLUMN     "foremanPhone" TEXT,
ADD COLUMN     "lastContactAt" DATE,
ADD COLUMN     "link" TEXT,
ADD COLUMN     "nextContactAt" DATE,
ADD COLUMN     "objectType" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "phoneNorm" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "sourceId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "crmContactId" TEXT;

-- CreateTable
CREATE TABLE "CrmOption" (
    "id" TEXT NOT NULL,
    "kind" "CrmOptionKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CrmOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmResult" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "group" "CrmResultGroup" NOT NULL,
    "nextRule" "CrmNextRule" NOT NULL,
    "defaultDays" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CrmResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channelId" TEXT,
    "resultId" TEXT,
    "productId" TEXT,
    "offeredPrice" DECIMAL(18,2),
    "nextContactDate" DATE,
    "userId" TEXT NOT NULL,
    "leadSourceId" TEXT,
    "objectName" TEXT,
    "objectArea" TEXT,
    "note" TEXT,
    "clientToken" TEXT,
    "importKey" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmOption_kind_code_key" ON "CrmOption"("kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CrmResult_code_key" ON "CrmResult"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_clientToken_key" ON "CrmContact"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_importKey_key" ON "CrmContact"("importKey");

-- CreateIndex
CREATE INDEX "CrmContact_customerId_date_idx" ON "CrmContact"("customerId", "date");

-- CreateIndex
CREATE INDEX "CrmContact_date_idx" ON "CrmContact"("date");

-- CreateIndex
CREATE INDEX "CrmContact_userId_date_idx" ON "CrmContact"("userId", "date");

-- CreateIndex
CREATE INDEX "CrmContact_resultId_idx" ON "CrmContact"("resultId");

-- CreateIndex
CREATE INDEX "Customer_phoneNorm_idx" ON "Customer"("phoneNorm");

-- CreateIndex
CREATE INDEX "Customer_crmAt_idx" ON "Customer"("crmAt");

-- CreateIndex
CREATE INDEX "Customer_ownerId_idx" ON "Customer"("ownerId");

-- CreateIndex
CREATE INDEX "Customer_nextContactAt_idx" ON "Customer"("nextContactAt");

-- CreateIndex
CREATE INDEX "Order_crmContactId_idx" ON "Order"("crmContactId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_clientTypeId_fkey" FOREIGN KEY ("clientTypeId") REFERENCES "CrmOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CrmOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_crmContactId_fkey" FOREIGN KEY ("crmContactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CrmOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "CrmResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CrmOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "CrmOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────── Mavjud mijozlar: telefonning +998XXXXXXXXX shakli (lib/phone.ts → normalizePhone bilan bir xil qoida) ─────────────
UPDATE "Customer" c SET "phoneNorm" = '+998' || x.local
FROM (
  SELECT id,
    CASE
      WHEN length(d) = 9 THEN d
      WHEN length(d) = 12 AND d LIKE '998%' THEN substr(d, 4)
      WHEN length(d) = 13 AND d LIKE '8998%' THEN substr(d, 5)
    END AS local
  FROM (SELECT id, regexp_replace(coalesce(phone, ''), '\D', '', 'g') AS d FROM "Customer") t
) x
WHERE x.id = c.id AND x.local ~ '^[1-9][0-9]{8}$';

-- ───────────── Ma'lumotnomalar (CRM_SPEC 3.5). Menejer keyin qo'shadi / nofaol qiladi ─────────────
INSERT INTO "CrmOption" ("id", "kind", "code", "label", "sort") VALUES
  ('crm_src_tender_mc',  'SOURCE', 'tender_mc',  'tender.mc.uz', 1),
  ('crm_src_uztender',   'SOURCE', 'uztender',   'UzTender (uztender.com)', 2),
  ('crm_src_ads',        'SOURCE', 'ads',        'Reklama', 3),
  ('crm_src_realizator', 'SOURCE', 'realizator', 'Realizator (ko''chada)', 4),
  ('crm_src_olx',        'SOURCE', 'olx',        'OLX', 5),
  ('crm_src_telegram',   'SOURCE', 'telegram',   'Telegram kanal yoki guruh', 6),
  ('crm_src_social',     'SOURCE', 'social',     'Instagram yoki Facebook', 7),
  ('crm_src_maps',       'SOURCE', 'maps',       'Google / 2GIS', 8),
  ('crm_src_site',       'SOURCE', 'site',       'O''z saytimiz', 9),
  ('crm_src_other_site', 'SOURCE', 'other_site', 'Boshqa sayt', 10),
  ('crm_src_referral',   'SOURCE', 'referral',   'Tavsiya', 11),
  ('crm_src_inbound',    'SOURCE', 'inbound',    'O''zi murojaat qildi', 12),
  ('crm_src_old',        'SOURCE', 'old_client', 'Eski mijoz', 13),
  ('crm_ct_builder',     'CLIENT_TYPE', 'builder',    'Quruvchi firma', 1),
  ('crm_ct_contractor',  'CLIENT_TYPE', 'contractor', 'Pudratchi', 2),
  ('crm_ct_state',       'CLIENT_TYPE', 'state',      'Davlat buyurtmachisi', 3),
  ('crm_ct_dealer',      'CLIENT_TYPE', 'dealer',     'Savdo / dilyer', 4),
  ('crm_ct_person',      'CLIENT_TYPE', 'person',     'Yakka shaxs', 5),
  ('crm_pr_slab',        'PRODUCT', 'slab',     'Plita', 1),
  ('crm_pr_concrete',    'PRODUCT', 'concrete', 'Beton', 2),
  ('crm_pr_pole',        'PRODUCT', 'pole',     'Opora', 3),
  ('crm_pr_other',       'PRODUCT', 'other',    'Boshqa', 4),
  ('crm_ch_call',        'CHANNEL', 'call',     'Qo''ng''iroq', 1),
  ('crm_ch_telegram',    'CHANNEL', 'telegram', 'Telegram', 2),
  ('crm_ch_meeting',     'CHANNEL', 'meeting',  'Uchrashuv', 3),
  ('crm_ch_incoming',    'CHANNEL', 'incoming', 'Kiruvchi qo''ng''iroq', 4),
  ('crm_ch_ads',         'CHANNEL', 'ads',      'Reklama orqali murojaat', 5)
ON CONFLICT ("kind", "code") DO NOTHING;

INSERT INTO "CrmResult" ("id", "code", "label", "stage", "group", "nextRule", "defaultDays", "sort") VALUES
  ('crm_res_no_answer',   'no_answer',   'Telefon ko''tarmadi',                 1, 'NO_ANSWER', 'REQUIRED', 1,    1),
  ('crm_res_phone_off',   'phone_off',   'Telefon o''chiq',                     1, 'NO_ANSWER', 'REQUIRED', 1,    2),
  ('crm_res_wrong_phone', 'wrong_phone', 'Telefon raqam noto''g''ri',           1, 'LOSS',      'NONE',     NULL, 3),
  ('crm_res_busy',        'busy',        'Band, keyinroq',                      2, 'CONTINUE',  'REQUIRED', 1,    4),
  ('crm_res_talked',      'talked',      'Gaplashildi',                         2, 'CONTINUE',  'REQUIRED', 3,    5),
  ('crm_res_callback',    'callback',    'Qayta aloqa kerak',                   2, 'CONTINUE',  'REQUIRED', 1,    6),
  ('crm_res_not_needed',  'not_needed',  'Kerak emas',                          2, 'REFUSAL',   'NONE',     NULL, 7),
  ('crm_res_far',         'far',         'Lokatsiyasi uzoq',                    2, 'REFUSAL',   'NONE',     NULL, 8),
  ('crm_res_competitor',  'competitor',  'Raqobatchidan oldi',                  2, 'REFUSAL',   'NONE',     NULL, 9),
  ('crm_res_has_need',    'has_need',    'Ehtiyoji bor',                        3, 'CONTINUE',  'REQUIRED', 1,    10),
  ('crm_res_asked_price', 'asked_price', 'Narx so''radi',                       3, 'CONTINUE',  'REQUIRED', 1,    11),
  ('crm_res_later',       'later',       'Keyinroq kerak (obyekt boshlanmagan)', 3, 'WAITING',  'REQUIRED', 30,   12),
  ('crm_res_offer_sent',  'offer_sent',  'Taklif yuborildi',                    4, 'CONTINUE',  'REQUIRED', 2,    13),
  ('crm_res_expensive',   'expensive',   'Qimmat dedi',                         4, 'REFUSAL',   'OPTIONAL', NULL, 14),
  ('crm_res_negotiating', 'negotiating', 'Muzokarada',                          5, 'CONTINUE',  'REQUIRED', 2,    15),
  ('crm_res_order',       'order',       'Zayafka oldim',                       6, 'WIN',       'NONE',     NULL, 16)
ON CONFLICT ("code") DO NOTHING;
