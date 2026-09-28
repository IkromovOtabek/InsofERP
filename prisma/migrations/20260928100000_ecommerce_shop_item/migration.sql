-- E-commerce vitrinasi: Insof ECO ilovasidagi do'konda ko'rinadigan mahsulotlar
-- (surat, tavsif, do'kon narxi). Product jadvaliga tegilmaydi.
CREATE TABLE "ShopItem" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "photo" TEXT,
    "price" DECIMAL(18,2),
    "minQty" DECIMAL(18,3),
    "badge" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopItem_productId_key" ON "ShopItem"("productId");

ALTER TABLE "ShopItem" ADD CONSTRAINT "ShopItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
