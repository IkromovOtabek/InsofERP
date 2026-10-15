-- CreateEnum
CREATE TYPE "SmmConnectMethod" AS ENUM ('OAUTH', 'MANUAL');

-- CreateEnum
CREATE TYPE "SmmAccountStatus" AS ENUM ('ACTIVE', 'ERROR', 'EXPIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SmmVideoStatus" AS ENUM ('QUEUED', 'GENERATING', 'RENDERING', 'DONE', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "MarketingContent" ADD COLUMN     "brief" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "locationName" TEXT;

-- AlterTable
ALTER TABLE "MarketingSettings" ADD COLUMN     "adAccountId" TEXT,
ADD COLUMN     "audience" TEXT,
ADD COLUMN     "brandAbout" TEXT,
ADD COLUMN     "brandTone" TEXT,
ADD COLUMN     "languages" TEXT NOT NULL DEFAULT 'ru,uz',
ADD COLUMN     "leadFormId" TEXT,
ADD COLUMN     "locations" JSONB;

-- CreateTable
CREATE TABLE "SmmAccount" (
    "id" TEXT NOT NULL,
    "channel" "SmmChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "pictureUrl" TEXT,
    "method" "SmmConnectMethod" NOT NULL DEFAULT 'MANUAL',
    "tokenEnc" TEXT,
    "userTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "pageId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "SmmAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "checkedAt" TIMESTAMP(3),
    "followers" INTEGER,
    "connectedById" TEXT,
    "connectedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmmAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmmAccountDaily" (
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER,
    "reach" INTEGER,
    "views" INTEGER,
    "profileViews" INTEGER,
    "websiteClicks" INTEGER,
    "interactions" INTEGER,

    CONSTRAINT "SmmAccountDaily_pkey" PRIMARY KEY ("accountId","date")
);

-- CreateTable
CREATE TABLE "SmmPost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "caption" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "avgWatchSec" DECIMAL(10,2),
    "statsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmmPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmmCompetitor" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "followers" INTEGER,
    "mediaCount" INTEGER,
    "avgLikes" INTEGER,
    "avgComments" INTEGER,
    "topPosts" JSONB,
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmmCompetitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmmInsightReport" (
    "id" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "ideas" JSONB NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmmInsightReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmmVideoJob" (
    "id" TEXT NOT NULL,
    "contentId" TEXT,
    "status" "SmmVideoStatus" NOT NULL DEFAULT 'QUEUED',
    "spec" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "outputMediaId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmmVideoJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmmAccount_channel_externalId_key" ON "SmmAccount"("channel", "externalId");

-- CreateIndex
CREATE INDEX "SmmPost_postedAt_idx" ON "SmmPost"("postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmmPost_accountId_externalId_key" ON "SmmPost"("accountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SmmCompetitor_username_key" ON "SmmCompetitor"("username");

-- CreateIndex
CREATE INDEX "SmmInsightReport_createdAt_idx" ON "SmmInsightReport"("createdAt");

-- CreateIndex
CREATE INDEX "SmmVideoJob_status_idx" ON "SmmVideoJob"("status");

-- AddForeignKey
ALTER TABLE "SmmAccountDaily" ADD CONSTRAINT "SmmAccountDaily_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SmmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmmPost" ADD CONSTRAINT "SmmPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SmmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmmVideoJob" ADD CONSTRAINT "SmmVideoJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "MarketingContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

