-- CreateEnum
CREATE TYPE "MarketingContentType" AS ENUM ('REELS', 'POST', 'STORIES', 'ARTICLE');

-- CreateEnum
CREATE TYPE "MarketingContentStatus" AS ENUM ('IDEA', 'SCRIPT', 'FILMED', 'EDITING', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdChannel" AS ENUM ('YANDEX', 'GOOGLE', 'INSTAGRAM', 'TELEGRAM', 'OTHER');

-- CreateEnum
CREATE TYPE "AdCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'FINISHED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "landingPage" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmTerm" TEXT;

-- CreateTable
CREATE TABLE "MarketingContent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MarketingContentType" NOT NULL DEFAULT 'REELS',
    "rubric" TEXT,
    "status" "MarketingContentStatus" NOT NULL DEFAULT 'IDEA',
    "publishDate" DATE,
    "hook" TEXT,
    "script" TEXT,
    "caption" TEXT,
    "url" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "AdChannel" NOT NULL,
    "status" "AdCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "utmCampaign" TEXT,
    "budget" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "spend" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATE,
    "endDate" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoKeyword" (
    "id" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "cluster" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'ru',
    "url" TEXT,
    "intent" TEXT,
    "frequency" INTEGER,
    "posYandex" INTEGER,
    "posGoogle" INTEGER,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingChat" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingContent_publishDate_idx" ON "MarketingContent"("publishDate");

-- CreateIndex
CREATE INDEX "MarketingContent_status_idx" ON "MarketingContent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaign_utmCampaign_key" ON "AdCampaign"("utmCampaign");

-- CreateIndex
CREATE INDEX "SeoKeyword_cluster_idx" ON "SeoKeyword"("cluster");

-- CreateIndex
CREATE UNIQUE INDEX "SeoKeyword_phrase_lang_key" ON "SeoKeyword"("phrase", "lang");

-- CreateIndex
CREATE INDEX "MarketingChat_userId_updatedAt_idx" ON "MarketingChat"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketingMessage_chatId_createdAt_idx" ON "MarketingMessage"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_utmCampaign_idx" ON "Lead"("utmCampaign");

-- AddForeignKey
ALTER TABLE "MarketingChat" ADD CONSTRAINT "MarketingChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "MarketingChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

