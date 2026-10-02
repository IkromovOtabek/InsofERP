-- Brak topshiriqqa bog'lanadi: topshiriq kartasida "nechtasi brak chiqdi" ko'rinadi.
ALTER TABLE "ProductDefect" ADD COLUMN IF NOT EXISTS "taskId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductDefect_taskId_idx" ON "ProductDefect"("taskId");
ALTER TABLE "ProductDefect" ADD CONSTRAINT "ProductDefect_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BrigadeTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
