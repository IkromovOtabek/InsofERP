-- AlterEnum
ALTER TYPE "HrDocKind" ADD VALUE 'BOSHATISH_BUYRUQ';

-- AlterTable
ALTER TABLE "HrDocument" ADD COLUMN     "article" TEXT;

