-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "bruNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "external" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "bru" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "external" BOOLEAN NOT NULL DEFAULT false;

