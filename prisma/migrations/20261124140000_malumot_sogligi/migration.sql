-- CreateTable
CREATE TABLE "DataHealthRun" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3),
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "problems" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL,
    "notified" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DataHealthRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataHealthRun_day_key" ON "DataHealthRun"("day");

-- CreateIndex
CREATE INDEX "DataHealthRun_ranAt_idx" ON "DataHealthRun"("ranAt");

