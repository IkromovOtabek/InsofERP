-- AlterEnum
ALTER TYPE "AmoAuthMethod" ADD VALUE 'WEBHOOK';

-- AlterTable
ALTER TABLE "AmoConnection" ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "lastWebhookInfo" TEXT;

