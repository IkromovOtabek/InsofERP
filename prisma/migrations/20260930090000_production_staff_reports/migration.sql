-- Ishlab chiqarish: xodimni brigadaga taqsimlash (direktor) va saqlanadigan kunlik hisobot
ALTER TABLE "Employee" ADD COLUMN "brigadeId" TEXT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProductionReport" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "data" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "seenById" TEXT,
    CONSTRAINT "ProductionReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionReport_date_idx" ON "ProductionReport"("date");
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
