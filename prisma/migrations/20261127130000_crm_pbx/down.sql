-- Qaytarish (qo'lda): psql ... < down.sql — onlinePBX qo'ng'iroqlari tarixi o'chadi, oldin pg_dump oling
BEGIN;
DROP TABLE IF EXISTS "CrmCall";
DROP INDEX IF EXISTS "User_pbxExt_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "pbxExt";
ALTER TABLE "CompanySettings" DROP COLUMN IF EXISTS "pbxSyncedAt";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261127130000_crm_pbx';
COMMIT;
