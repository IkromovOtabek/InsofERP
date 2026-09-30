-- CreateEnum
CREATE TYPE "BrigadeIssueKind" AS ENUM ('DELAY', 'EQUIPMENT', 'MATERIAL', 'STAFF', 'QUALITY', 'OTHER');

-- AlterTable
ALTER TABLE "BrigadeTask" ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BrigadeShift" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "report" JSONB,
    "summary" TEXT,
    "note" TEXT,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "BrigadeShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrigadeIssue" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "taskId" TEXT,
    "kind" "BrigadeIssueKind" NOT NULL,
    "equipment" TEXT,
    "qty" DECIMAL(18,3),
    "downtimeMin" INTEGER,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "BrigadeIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrigadeShift_date_idx" ON "BrigadeShift"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BrigadeShift_brigadeId_date_key" ON "BrigadeShift"("brigadeId", "date");

-- CreateIndex
CREATE INDEX "BrigadeIssue_brigadeId_createdAt_idx" ON "BrigadeIssue"("brigadeId", "createdAt");

-- CreateIndex
CREATE INDEX "BrigadeIssue_resolvedAt_idx" ON "BrigadeIssue"("resolvedAt");

-- AddForeignKey
ALTER TABLE "BrigadeShift" ADD CONSTRAINT "BrigadeShift_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeShift" ADD CONSTRAINT "BrigadeShift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeShift" ADD CONSTRAINT "BrigadeShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeIssue" ADD CONSTRAINT "BrigadeIssue_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeIssue" ADD CONSTRAINT "BrigadeIssue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BrigadeTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeIssue" ADD CONSTRAINT "BrigadeIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeIssue" ADD CONSTRAINT "BrigadeIssue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

