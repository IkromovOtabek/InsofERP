-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('SALE', 'STOCK');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "kind" "OrderKind" NOT NULL DEFAULT 'SALE';
