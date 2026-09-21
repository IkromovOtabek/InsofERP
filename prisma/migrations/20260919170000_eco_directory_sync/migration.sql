-- Insof ECO spravochnik sinxroni: xodim/texnika kartasida oxirgi sinxron holati
ALTER TABLE "Employee" ADD COLUMN "ecoActive" BOOLEAN;
ALTER TABLE "Employee" ADD COLUMN "ecoSyncedAt" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "ecoError" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "ecoSyncedAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "ecoError" TEXT;
