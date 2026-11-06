-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "blockId" TEXT;

-- CreateTable
CREATE TABLE "SiteBlock" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteBlock_siteId_name_key" ON "SiteBlock"("siteId", "name");

-- CreateIndex
CREATE INDEX "OrderItem_blockId_idx" ON "OrderItem"("blockId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "SiteBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBlock" ADD CONSTRAINT "SiteBlock_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

