-- CreateEnum
CREATE TYPE "HrCallStatus" AS ENUM ('WAITING', 'CAME', 'NO_SHOW', 'NO_ANSWER', 'HIRED');

-- CreateTable
CREATE TABLE "HrCallLog" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "position" TEXT NOT NULL,
    "phone" TEXT,
    "fullName" TEXT,
    "address" TEXT,
    "age" INTEGER,
    "status" "HrCallStatus" NOT NULL DEFAULT 'WAITING',
    "visitDate" DATE,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrCallLog_date_idx" ON "HrCallLog"("date");

-- CreateIndex
CREATE INDEX "HrCallLog_phone_idx" ON "HrCallLog"("phone");

