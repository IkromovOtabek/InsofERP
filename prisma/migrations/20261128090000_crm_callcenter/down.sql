-- Orqaga qaytarish (qo'lda). Role enum'dan CALL_CENTER qiymati olib tashlanmaydi (PostgreSQL'da enum qiymatini o'chirish yo'q);
-- avval shu roldagi foydalanuvchilarni boshqa rolga o'tkazing.
ALTER TABLE "CrmCall" DROP CONSTRAINT IF EXISTS "CrmCall_takenById_fkey";
ALTER TABLE "CrmCall" DROP CONSTRAINT IF EXISTS "CrmCall_handledById_fkey";
DROP INDEX IF EXISTS "CrmCall_direction_handledAt_idx";
DROP INDEX IF EXISTS "CrmCall_state_idx";
ALTER TABLE "CrmCall" DROP COLUMN IF EXISTS "handledAt", DROP COLUMN IF EXISTS "handledById", DROP COLUMN IF EXISTS "state", DROP COLUMN IF EXISTS "takenAt", DROP COLUMN IF EXISTS "takenById";
ALTER TABLE "CompanySettings" DROP COLUMN IF EXISTS "pbxWebhookAt", DROP COLUMN IF EXISTS "pbxWebhookKey";
