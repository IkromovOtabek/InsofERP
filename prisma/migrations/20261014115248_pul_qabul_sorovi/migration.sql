-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('CASH', 'BANK');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "payMethod" "PayMethod";

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "method" "PayMethod" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "received" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_docNo_key" ON "PaymentRequest"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_orderId_key" ON "PaymentRequest"("orderId");

-- CreateIndex
CREATE INDEX "PaymentRequest_method_status_dueDate_idx" ON "PaymentRequest"("method", "status", "dueDate");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_closedAt_idx" ON "PaymentRequest"("status", "closedAt");

-- CreateIndex
CREATE INDEX "PaymentRequest_customerId_idx" ON "PaymentRequest"("customerId");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mavjud ochiq zayavkalarning kutilayotgan bosh to'lovi (prepayAmount) — so'rovga aylanadi.
-- Eski oqimda avansni kassir qabul qilardi — usul CASH. Tushgani: zayavka avansi + zayavka schyotlariga to'lovlar.
INSERT INTO "PaymentRequest" ("id", "docNo", "orderId", "customerId", "method", "amount", "received", "status", "dueDate", "createdById", "createdAt", "updatedAt", "closedAt")
SELECT 'prq' || substr(md5(o."id"), 1, 22),
       'PS-' || to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY') || '-' || lpad((row_number() OVER (ORDER BY o."createdAt", o."id"))::text, 5, '0'),
       o."id", o."customerId", 'CASH', o."prepayAmount", LEAST(o."prepayAmount", p.paid),
       CASE WHEN p.paid >= o."prepayAmount" - 0.005 THEN 'RECEIVED' WHEN p.paid > 0.005 THEN 'PARTIAL' ELSE 'PENDING' END::"PaymentRequestStatus",
       o."deliveryDate", o."createdById", o."createdAt", now(),
       CASE WHEN p.paid >= o."prepayAmount" - 0.005 THEN now() ELSE NULL END
FROM "Order" o
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(x."amount"), 0) AS paid FROM "Payment" x
  LEFT JOIN "Invoice" v ON v."id" = x."invoiceId"
  WHERE x."orderId" = o."id" OR v."orderId" = o."id"
) p
WHERE o."kind" = 'SALE' AND o."prepayAmount" > 0
  AND o."status" IN ('DRAFT', 'BLOCKED', 'CONFIRMED', 'IN_PRODUCTION', 'DELIVERED');

UPDATE "Order" SET "payMethod" = 'CASH' WHERE "prepayAmount" > 0 AND "payMethod" IS NULL;
