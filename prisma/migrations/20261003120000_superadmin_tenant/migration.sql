-- Ko'p korxonali platforma: IT superadmin roli (markaziy paneldan SSO) va korxonani to'xtatish belgisi
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPERADMIN';

ALTER TABLE "CompanySettings" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "CompanySettings" ADD COLUMN "suspendReason" TEXT;
