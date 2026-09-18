-- ADMIN foydalanuvchilarni DIRECTOR ga o'tkazish (enum qiymati o'chirilishidan oldin)
UPDATE "User" SET "role" = 'DIRECTOR' WHERE "role" = 'ADMIN';
-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('DIRECTOR', 'SALES', 'PRODUCTION', 'LOGISTICS', 'WAREHOUSE', 'PROCUREMENT', 'ACCOUNTING', 'FINANCE', 'HR', 'CASHIER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL DEFAULT 'Insof beton zavodi',
    "legalName" TEXT,
    "inn" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "phone2" TEXT,
    "email" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "mfo" TEXT,
    "directorName" TEXT,
    "about" TEXT,
    "workingHours" TEXT DEFAULT 'Dush–Shan 08:00–18:00',
    "foundedYear" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

