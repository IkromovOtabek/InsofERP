-- CreateEnum
CREATE TYPE "HrDocKind" AS ENUM ('ARIZA', 'ANKETA', 'SHARTNOMA', 'TILXAT', 'JAVOBGARLIK', 'BUYRUQ', 'BOSHATISH');

-- CreateTable
CREATE TABLE "HrDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "HrDocKind" NOT NULL,
    "no" TEXT,
    "docDate" DATE NOT NULL,
    "effectiveAt" DATE,
    "position" TEXT,
    "salary" DECIMAL(18,2),
    "fixedTerm" BOOLEAN NOT NULL DEFAULT false,
    "termUntil" DATE,
    "reason" TEXT,
    "file" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrDocument_employeeId_idx" ON "HrDocument"("employeeId");

-- CreateIndex
CREATE INDEX "HrDocument_kind_docDate_idx" ON "HrDocument"("kind", "docDate");

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
