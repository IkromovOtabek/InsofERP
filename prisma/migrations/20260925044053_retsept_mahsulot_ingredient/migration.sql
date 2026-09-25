-- Retsept qatori endi xomashyo O'RNIGA boshqa mahsulotga ham bog'lanishi mumkin
-- (masalan FBS blok kabi tayyor mahsulot boshqa mahsulotga ingredient bo'lib kirsin).
-- App qatlamida "yo materialId, yo productId" qoidasi saqlanadi (StockMove dagi kabi).

-- DropForeignKey
ALTER TABLE "RecipeItem" DROP CONSTRAINT "RecipeItem_materialId_fkey";

-- AlterTable
ALTER TABLE "RecipeItem" ADD COLUMN     "productId" TEXT,
ALTER COLUMN "materialId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RecipeItem_recipeId_productId_key" ON "RecipeItem"("recipeId", "productId");

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
