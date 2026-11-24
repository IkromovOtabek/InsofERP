-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

