-- Oldindan to'lov (avans): zayavka ochilganda olingan pul Payment sifatida yoziladi va zayavkaga bog'lanadi.
ALTER TABLE "Payment" ADD COLUMN "orderId" TEXT;

CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
