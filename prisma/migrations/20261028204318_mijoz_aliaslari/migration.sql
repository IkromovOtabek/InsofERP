-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

