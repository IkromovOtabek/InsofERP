-- AlterTable
ALTER TABLE "Brigade" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "BrigadeHours" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrigadeHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrigadeOutput" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "line" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrigadeOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrigadeMonth" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "brak" DECIMAL(18,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrigadeMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrigadeHours_date_idx" ON "BrigadeHours"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BrigadeHours_brigadeId_employeeId_date_key" ON "BrigadeHours"("brigadeId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "BrigadeOutput_date_idx" ON "BrigadeOutput"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BrigadeOutput_brigadeId_date_line_key" ON "BrigadeOutput"("brigadeId", "date", "line");

-- CreateIndex
CREATE UNIQUE INDEX "BrigadeMonth_brigadeId_month_key" ON "BrigadeMonth"("brigadeId", "month");

-- AddForeignKey
ALTER TABLE "BrigadeHours" ADD CONSTRAINT "BrigadeHours_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeHours" ADD CONSTRAINT "BrigadeHours_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeOutput" ADD CONSTRAINT "BrigadeOutput_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeMonth" ADD CONSTRAINT "BrigadeMonth_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

