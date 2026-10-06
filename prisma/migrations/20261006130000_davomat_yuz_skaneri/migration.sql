-- Davomat — mobil ilova ichidagi yuz skaneri: "Keldi" / "Ketdi" kadrining yuz mosligi ishonchi (0–100).
-- Faqat qo'shimcha ustunlar — mavjud yozuvlar o'zgarmaydi.

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "faceConfidence" INTEGER,
ADD COLUMN "checkOutFaceConfidence" INTEGER;
