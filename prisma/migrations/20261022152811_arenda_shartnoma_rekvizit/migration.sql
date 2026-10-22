-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "rentLessor" JSONB;

-- AlterTable
ALTER TABLE "RentLease" ADD COLUMN     "tenantAccount" TEXT,
ADD COLUMN     "tenantAddress" TEXT,
ADD COLUMN     "tenantMfo" TEXT,
ADD COLUMN     "tenantRep" TEXT;

-- AlterTable
ALTER TABLE "RentShop" ADD COLUMN     "address" TEXT,
ADD COLUMN     "cadastre" TEXT;

