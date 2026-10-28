-- CreateEnum
CREATE TYPE "CalendarDayKind" AS ENUM ('HOLIDAY', 'WORKDAY');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "lunchEnd" TEXT,
ADD COLUMN     "lunchStart" TEXT,
ADD COLUMN     "restDays" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
ADD COLUMN     "workEnd" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "workStart" TEXT NOT NULL DEFAULT '08:00';

-- CreateTable
CREATE TABLE "WorkCalendarDay" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "CalendarDayKind" NOT NULL DEFAULT 'HOLIDAY',
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCalendarDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkCalendarDay_date_key" ON "WorkCalendarDay"("date");

