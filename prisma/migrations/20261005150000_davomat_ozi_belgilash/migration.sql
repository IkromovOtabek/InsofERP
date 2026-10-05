-- Xodim o'zi telefonidan davomat belgilaydi ("Keldim" / "Ketdim"): Face ID / barmoq izi + GPS geofence.
-- Faqat qo'shimcha ustunlar (NULL yoki standart qiymatli) — mavjud yozuvlar va kod o'zgarmaydi.

-- AlterTable
ALTER TABLE "Attendance"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "checkInLat" DOUBLE PRECISION,
  ADD COLUMN "checkInLng" DOUBLE PRECISION,
  ADD COLUMN "checkInAccuracy" DOUBLE PRECISION,
  ADD COLUMN "checkInDistance" DOUBLE PRECISION,
  ADD COLUMN "checkInDeviceId" TEXT,
  ADD COLUMN "checkOutLat" DOUBLE PRECISION,
  ADD COLUMN "checkOutLng" DOUBLE PRECISION,
  ADD COLUMN "checkOutAccuracy" DOUBLE PRECISION,
  ADD COLUMN "checkOutDistance" DOUBLE PRECISION,
  ADD COLUMN "checkOutDeviceId" TEXT,
  ADD COLUMN "lateMinutes" INTEGER,
  ADD COLUMN "newDevice" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN "attendanceRadiusM" INTEGER NOT NULL DEFAULT 300;
