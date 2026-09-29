-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'REPAIR', 'IDLE');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "alertCritPct" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "alertWarnPct" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "overdueDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "stockCritDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "stockWarnDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "statusNote" TEXT,
ADD COLUMN     "statusSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExpenseBudget" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "limit" DECIMAL(18,2),
    "note" TEXT,
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseBudget_year_month_category_key" ON "ExpenseBudget"("year", "month", "category");

-- AddForeignKey
ALTER TABLE "ExpenseBudget" ADD CONSTRAINT "ExpenseBudget_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
