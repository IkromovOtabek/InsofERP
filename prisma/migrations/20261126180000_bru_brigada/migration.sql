-- AlterTable
ALTER TABLE "Brigade" ADD COLUMN     "isBru" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "bruId" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "bruId" TEXT;

-- CreateIndex
CREATE INDEX "OrderItem_bruId_idx" ON "OrderItem"("bruId");

-- CreateIndex
CREATE INDEX "Trip_bruId_idx" ON "Trip"("bruId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_bruId_fkey" FOREIGN KEY ("bruId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_bruId_fkey" FOREIGN KEY ("bruId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Logistika → Sozlamalardagi BRU nomlari → BRU brigadalari (nomi bir xil brigada bo'lsa — o'sha belgilanadi)
UPDATE "Brigade" b SET "isBru" = true
  FROM "CompanySettings" c
 WHERE c.id = 'main' AND lower(trim(b.name)) IN (SELECT lower(trim(x)) FROM unnest(c."bruNames") x);

INSERT INTO "Brigade" (id, name, "isBru", "isActive", aliases, "createdAt")
SELECT 'bru' || substr(md5(n), 1, 22), n, true, true, '{}', now()
  FROM (SELECT DISTINCT trim(x) AS n FROM "CompanySettings" c, unnest(c."bruNames") x WHERE c.id = 'main' AND trim(x) <> '') s
 WHERE NOT EXISTS (SELECT 1 FROM "Brigade" b WHERE lower(trim(b.name)) = lower(s.n));

-- Eski reyslar: BRU nomi bo'yicha bog'lanadi
UPDATE "Trip" t SET "bruId" = b.id
  FROM "Brigade" b
 WHERE t.bru IS NOT NULL AND b."isBru" AND lower(trim(b.name)) = lower(trim(t.bru));
