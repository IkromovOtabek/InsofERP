-- Davomat — ERP'ning o'z Face ID skaneri (Bosh sahifa → Davomat): xodim yuzi namunasi (128 sonli vektor),
-- rozilik vaqti va "Ketdi" kadri. Faqat qo'shimcha jadval/ustunlar — mavjud yozuvlar va kod o'zgarmaydi.

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "faceConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "checkOutPhoto" TEXT;

-- CreateTable
CREATE TABLE "FaceTemplate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "descriptor" DOUBLE PRECISION[],
    "photo" TEXT,
    "score" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FaceTemplate_employeeId_idx" ON "FaceTemplate"("employeeId");

-- AddForeignKey
ALTER TABLE "FaceTemplate" ADD CONSTRAINT "FaceTemplate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
