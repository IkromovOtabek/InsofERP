-- Mobil yuz skaneri — jonlilik (liveness): challenge nonce'iga tasodifiy topshiriq (BLINK / TURN_LEFT / TURN_RIGHT)
-- bog'lanadi (`lib/face-liveness.ts`). Faqat ixtiyoriy ustun — mavjud nonce'lar (task = null) eskicha ishlaydi.

-- AlterTable
ALTER TABLE "FaceNonce" ADD COLUMN "task" TEXT;
