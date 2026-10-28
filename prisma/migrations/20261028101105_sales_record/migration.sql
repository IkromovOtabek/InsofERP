-- CreateTable
CREATE TABLE "SalesRecord" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "workDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesRecord_group_key" ON "SalesRecord"("group");

