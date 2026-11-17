-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "advanceAmount" DECIMAL(18,2),
ADD COLUMN     "cardAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "PayrollLine" ADD COLUMN     "cardAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cardTxId" TEXT;

