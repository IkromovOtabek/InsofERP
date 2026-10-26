-- DropIndex
DROP INDEX "BrigadeTask_orderItemId_key";

-- CreateIndex
CREATE INDEX "BrigadeTask_orderItemId_idx" ON "BrigadeTask"("orderItemId");

