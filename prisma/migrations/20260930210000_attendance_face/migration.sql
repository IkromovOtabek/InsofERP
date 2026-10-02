-- Davomat "Keldi" yuz bilan tasdiqlanganda: kamera kadri va tasdiq vaqti (mobil `att.face`).
ALTER TABLE "Attendance"
  ADD COLUMN IF NOT EXISTS "facePhoto" TEXT,
  ADD COLUMN IF NOT EXISTS "faceVerifiedAt" TIMESTAMP(3);
