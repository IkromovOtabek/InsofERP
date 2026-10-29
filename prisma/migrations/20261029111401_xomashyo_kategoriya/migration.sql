-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('XOMASHYO', 'ZAVOD_ZAPCHAST', 'AVTO_ZAPCHAST');

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "category" "MaterialCategory" NOT NULL DEFAULT 'XOMASHYO';

-- CreateIndex
CREATE INDEX "Material_category_idx" ON "Material"("category");

