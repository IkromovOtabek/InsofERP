-- AlterTable
ALTER TABLE "MarketingSettings" ADD COLUMN     "autoDaily" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoDailyAt" TIMESTAMP(3),
ADD COLUMN     "autoDrafts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "autoRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "autoWeekly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoWeeklyAt" TIMESTAMP(3);

