-- AlterTable
ALTER TABLE "SuperAdmin" ADD COLUMN     "ecoPhone" TEXT,
ADD COLUMN     "ecoUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_ecoUserId_key" ON "SuperAdmin"("ecoUserId");

