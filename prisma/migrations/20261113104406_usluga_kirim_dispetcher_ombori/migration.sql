-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerRevenueType" ADD VALUE 'SERVICE_BANK';
ALTER TYPE "LedgerRevenueType" ADD VALUE 'SERVICE_CASH';

-- AlterEnum
ALTER TYPE "StockMoveType" ADD VALUE 'TRANSFER';

