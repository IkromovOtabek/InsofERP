-- Qaytarish (qo'lda): docker exec -i insof-pg psql -U otabek -d insof_erp < prisma/migrations/20261127090000_crm/down.sql
-- keyin: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261127090000_crm';  (shu faylning oxirida bor)
-- Diqqat: CRM aloqalari va mijozlarning CRM maydonlari o'chadi — oldin pg_dump oling.
BEGIN;
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_crmContactId_fkey";
DROP INDEX IF EXISTS "Order_crmContactId_idx";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "crmContactId";
DROP TABLE IF EXISTS "CrmContact";
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_ownerId_fkey",
  DROP CONSTRAINT IF EXISTS "Customer_clientTypeId_fkey",
  DROP CONSTRAINT IF EXISTS "Customer_sourceId_fkey";
DROP INDEX IF EXISTS "Customer_phoneNorm_idx";
DROP INDEX IF EXISTS "Customer_crmAt_idx";
DROP INDEX IF EXISTS "Customer_ownerId_idx";
DROP INDEX IF EXISTS "Customer_nextContactAt_idx";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "clientTypeId", DROP COLUMN IF EXISTS "crmAt", DROP COLUMN IF EXISTS "crmNote",
  DROP COLUMN IF EXISTS "crmStatus", DROP COLUMN IF EXISTS "crmStatusManual", DROP COLUMN IF EXISTS "district",
  DROP COLUMN IF EXISTS "foremanName", DROP COLUMN IF EXISTS "foremanPhone", DROP COLUMN IF EXISTS "lastContactAt",
  DROP COLUMN IF EXISTS "link", DROP COLUMN IF EXISTS "nextContactAt", DROP COLUMN IF EXISTS "objectType",
  DROP COLUMN IF EXISTS "ownerId", DROP COLUMN IF EXISTS "phoneNorm", DROP COLUMN IF EXISTS "region", DROP COLUMN IF EXISTS "sourceId";
ALTER TABLE "CompanySettings" DROP COLUMN IF EXISTS "crmActiveDays", DROP COLUMN IF EXISTS "crmColdDays";
DROP TABLE IF EXISTS "CrmResult";
DROP TABLE IF EXISTS "CrmOption";
DROP TYPE IF EXISTS "CrmNextRule";
DROP TYPE IF EXISTS "CrmResultGroup";
DROP TYPE IF EXISTS "CrmClientStatus";
DROP TYPE IF EXISTS "CrmOptionKind";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261127090000_crm';
COMMIT;
