-- CreateEnum
CREATE TYPE "SmmChannel" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "SmmApproval" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SmmMediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "SmmPublicationStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "SmmBoostObjective" AS ENUM ('REACH', 'MESSAGES', 'LEADS');

-- CreateEnum
CREATE TYPE "SmmBoostStatus" AS ENUM ('PENDING_APPROVAL', 'REJECTED', 'LAUNCHING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'SIMULATED');

-- AlterTable
ALTER TABLE "MarketingContent" ADD COLUMN     "approval" "SmmApproval" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "captionUz" TEXT,
ADD COLUMN     "channels" "SmmChannel"[] DEFAULT ARRAY[]::"SmmChannel"[],
ADD COLUMN     "hashtags" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SmmMedia" (
    "id" TEXT NOT NULL,
    "kind" "SmmMediaKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedById" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmmMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentMedia" (
    "contentId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketingContentMedia_pkey" PRIMARY KEY ("contentId","mediaId")
);

-- CreateTable
CREATE TABLE "SmmPublication" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "channel" "SmmChannel" NOT NULL,
    "status" "SmmPublicationStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "statsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmmPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmmBoost" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "objective" "SmmBoostObjective" NOT NULL DEFAULT 'REACH',
    "audience" TEXT NOT NULL,
    "dailyBudget" DECIMAL(18,2) NOT NULL,
    "days" INTEGER NOT NULL,
    "status" "SmmBoostStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedById" TEXT,
    "requestedByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "note" TEXT,
    "metaCampaignId" TEXT,
    "metaAdSetId" TEXT,
    "metaAdId" TEXT,
    "error" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "spend" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER NOT NULL DEFAULT 0,
    "statsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmmBoost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSettings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "adCurrency" TEXT NOT NULL DEFAULT 'USD',
    "boostDailyCap" DECIMAL(18,2) NOT NULL DEFAULT 20,
    "boostMonthlyCap" DECIMAL(18,2) NOT NULL DEFAULT 300,
    "defaultHashtags" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmmMedia_createdAt_idx" ON "SmmMedia"("createdAt");

-- CreateIndex
CREATE INDEX "MarketingContentMedia_mediaId_idx" ON "MarketingContentMedia"("mediaId");

-- CreateIndex
CREATE INDEX "SmmPublication_status_idx" ON "SmmPublication"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SmmPublication_contentId_channel_key" ON "SmmPublication"("contentId", "channel");

-- CreateIndex
CREATE INDEX "SmmBoost_status_idx" ON "SmmBoost"("status");

-- CreateIndex
CREATE INDEX "SmmBoost_contentId_idx" ON "SmmBoost"("contentId");

-- CreateIndex
CREATE INDEX "MarketingContent_approval_scheduledAt_idx" ON "MarketingContent"("approval", "scheduledAt");

-- AddForeignKey
ALTER TABLE "MarketingContentMedia" ADD CONSTRAINT "MarketingContentMedia_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "MarketingContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentMedia" ADD CONSTRAINT "MarketingContentMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "SmmMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmmPublication" ADD CONSTRAINT "SmmPublication_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "MarketingContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmmBoost" ADD CONSTRAINT "SmmBoost_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "MarketingContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

