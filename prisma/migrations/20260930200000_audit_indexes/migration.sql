-- Audit 2026-09-30: qarz/limit (customersCredit), kassa qoldiqlari va ro'yxatlar filtrlari uchun indekslar.
-- Postgres tashqi kalitlarga indeksni o'zi yaratmaydi. IF NOT EXISTS — qayta ishga tushsa ham xavfsiz.
CREATE INDEX IF NOT EXISTS "Payment_customerId_idx" ON "Payment"("customerId");
CREATE INDEX IF NOT EXISTS "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX IF NOT EXISTS "Payment_date_idx" ON "Payment"("date");
CREATE INDEX IF NOT EXISTS "Payment_cashAccountId_idx" ON "Payment"("cashAccountId");
CREATE INDEX IF NOT EXISTS "Invoice_customerId_status_idx" ON "Invoice"("customerId", "status");
CREATE INDEX IF NOT EXISTS "Invoice_orderId_idx" ON "Invoice"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX IF NOT EXISTS "Order_status_date_idx" ON "Order"("status", "date");
CREATE INDEX IF NOT EXISTS "CashTransaction_cashAccountId_idx" ON "CashTransaction"("cashAccountId");
CREATE INDEX IF NOT EXISTS "CashTransaction_refType_refId_idx" ON "CashTransaction"("refType", "refId");
CREATE INDEX IF NOT EXISTS "Trip_orderId_idx" ON "Trip"("orderId");
