-- Mobil yuz skaneri — qayta yuborishga (replay) qarshi: bir martalik challenge (nonce) va qabul qilingan kadrlar xeshi.
-- Faqat yangi jadvallar — mavjud yozuvlar va jadvallar o'zgarmaydi.

-- CreateTable
CREATE TABLE "FaceNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacePhotoHash" (
    "hash" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacePhotoHash_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "FaceNonce_nonce_key" ON "FaceNonce"("nonce");

-- CreateIndex
CREATE INDEX "FaceNonce_userId_idx" ON "FaceNonce"("userId");

-- CreateIndex
CREATE INDEX "FaceNonce_expiresAt_idx" ON "FaceNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "FacePhotoHash_createdAt_idx" ON "FacePhotoHash"("createdAt");
