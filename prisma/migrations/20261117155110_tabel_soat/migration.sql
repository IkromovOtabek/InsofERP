-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "hours" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "EmployeeAlias" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAlias_name_key" ON "EmployeeAlias"("name");

-- CreateIndex
CREATE INDEX "EmployeeAlias_employeeId_idx" ON "EmployeeAlias"("employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeAlias" ADD CONSTRAINT "EmployeeAlias_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

