-- CreateTable
CREATE TABLE "PayrollWorkbook" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "PayrollWorkbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSheet" (
    "id" TEXT NOT NULL,
    "workbookId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollWorkbook_month_cancelledAt_idx" ON "PayrollWorkbook"("month", "cancelledAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSheet_workbookId_position_key" ON "PayrollSheet"("workbookId", "position");

-- AddForeignKey
ALTER TABLE "PayrollSheet" ADD CONSTRAINT "PayrollSheet_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "PayrollWorkbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

