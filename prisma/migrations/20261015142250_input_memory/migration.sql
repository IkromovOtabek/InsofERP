-- CreateTable
CREATE TABLE "InputMemory" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(160) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InputMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InputMemory_key_lastUsedAt_idx" ON "InputMemory"("key", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InputMemory_key_value_key" ON "InputMemory"("key", "value");

