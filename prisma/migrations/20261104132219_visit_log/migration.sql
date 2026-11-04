-- CreateEnum
CREATE TYPE "VisitKind" AS ENUM ('PAGE', 'LOGIN');

-- CreateTable
CREATE TABLE "VisitLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "VisitKind" NOT NULL,
    "path" TEXT,
    "method" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "device" TEXT NOT NULL,
    "os" TEXT,
    "browser" TEXT,
    "superadmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitLog_createdAt_idx" ON "VisitLog"("createdAt");

-- CreateIndex
CREATE INDEX "VisitLog_userId_createdAt_idx" ON "VisitLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

