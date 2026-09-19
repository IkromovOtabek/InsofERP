-- Shartnoma: zayavkaga shartnoma raqami, summasi va sanasi. Mahsulot summasi shartnoma summasidan ayiriladi.
ALTER TABLE "Order" ADD COLUMN "contractNo" TEXT;
ALTER TABLE "Order" ADD COLUMN "contractAmount" DECIMAL(18,2);
ALTER TABLE "Order" ADD COLUMN "contractAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_contractNo_key" ON "Order"("contractNo");
