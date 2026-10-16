-- CreateEnum
CREATE TYPE "WorkTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "KpiSource" AS ENUM ('MANUAL', 'ATTENDANCE', 'TASKS', 'CHECKLIST', 'SALES_M3', 'PRODUCTION');

-- CreateTable
CREATE TABLE "WorkTask" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "dueDate" DATE,
    "dueTime" TEXT,
    "priority" "WorkTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "WorkTaskStatus" NOT NULL DEFAULT 'TODO',
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "returnNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "clientToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "items" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistRun" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "done" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "doneCount" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiMetric" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "KpiSource" NOT NULL,
    "unit" TEXT NOT NULL,
    "position" TEXT,
    "employeeId" TEXT,
    "target" DECIMAL(18,3) NOT NULL,
    "reward" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minPct" INTEGER NOT NULL DEFAULT 80,
    "capPct" INTEGER NOT NULL DEFAULT 120,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiResult" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "fact" DECIMAL(18,3) NOT NULL,
    "note" TEXT,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkTask_docNo_key" ON "WorkTask"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTask_clientToken_key" ON "WorkTask"("clientToken");

-- CreateIndex
CREATE INDEX "WorkTask_assigneeId_status_idx" ON "WorkTask"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkTask_createdById_status_idx" ON "WorkTask"("createdById", "status");

-- CreateIndex
CREATE INDEX "WorkTask_dueDate_idx" ON "WorkTask"("dueDate");

-- CreateIndex
CREATE INDEX "WorkTaskComment_taskId_idx" ON "WorkTaskComment"("taskId");

-- CreateIndex
CREATE INDEX "ChecklistRun_employeeId_date_idx" ON "ChecklistRun"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistRun_templateId_employeeId_date_key" ON "ChecklistRun"("templateId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "KpiResult_month_idx" ON "KpiResult"("month");

-- CreateIndex
CREATE UNIQUE INDEX "KpiResult_metricId_employeeId_month_key" ON "KpiResult"("metricId", "employeeId", "month");

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTaskComment" ADD CONSTRAINT "WorkTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiResult" ADD CONSTRAINT "KpiResult_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "KpiMetric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiResult" ADD CONSTRAINT "KpiResult_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

