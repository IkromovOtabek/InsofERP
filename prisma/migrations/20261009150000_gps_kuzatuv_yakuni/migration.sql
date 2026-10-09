-- Haydovchi GPS kuzatuvi: oxirgi nuqta va "tirikman" Trip'da, reys yakuni (km, vaqt, iz), rejadagi yo'l,
-- avtomatik ogohlantirishlar (TripAlert), nuqta aniqligi va takroriy nuqtalarga qarshi unique (tripId, at).
-- Kengaytiruvchi: faqat yangi ustun/jadval; eski kod yangi bazada ishlayveradi.

-- Takroriy nuqtalar (bufer qayta yuborilgan) — unique indeksdan oldin bittasi qoldiriladi
DELETE FROM "TripPosition" a USING "TripPosition" b
WHERE a."tripId" = b."tripId" AND a."at" = b."at" AND a."id" > b."id";

-- DropIndex
DROP INDEX "TripPosition_tripId_at_idx";

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "gpsCleanupAt" TIMESTAMP(3),
ADD COLUMN     "gpsWatchAt" TIMESTAMP(3),
ADD COLUMN     "offRouteM" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "stopAlertMin" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "arrivalNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "avgSpeedKmh" DOUBLE PRECISION,
ADD COLUMN     "distanceKm" DOUBLE PRECISION,
ADD COLUMN     "gpsPlatform" TEXT,
ADD COLUMN     "lastAt" TIMESTAMP(3),
ADD COLUMN     "lastHeading" DOUBLE PRECISION,
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "lastSpeedKmh" DOUBLE PRECISION,
ADD COLUMN     "maxSpeedKmh" DOUBLE PRECISION,
ADD COLUMN     "movingSec" INTEGER,
ADD COLUMN     "plannedKm" DOUBLE PRECISION,
ADD COLUMN     "plannedMin" INTEGER,
ADD COLUMN     "plannedRoute" TEXT,
ADD COLUMN     "plannedRouteAt" TIMESTAMP(3),
ADD COLUMN     "summaryAt" TIMESTAMP(3),
ADD COLUMN     "totalSec" INTEGER,
ADD COLUMN     "trackLine" TEXT,
ADD COLUMN     "trackPoints" INTEGER;

-- AlterTable
ALTER TABLE "TripPosition" ADD COLUMN     "accuracy" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TripAlert" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "since" TIMESTAMP(3),
    "info" TEXT,

    CONSTRAINT "TripAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripAlert_tripId_closedAt_idx" ON "TripAlert"("tripId", "closedAt");

-- CreateIndex
CREATE INDEX "TripAlert_closedAt_idx" ON "TripAlert"("closedAt");

-- CreateIndex
CREATE INDEX "TripPosition_at_idx" ON "TripPosition"("at");

-- CreateIndex
CREATE UNIQUE INDEX "TripPosition_tripId_at_key" ON "TripPosition"("tripId", "at");

-- AddForeignKey
ALTER TABLE "TripAlert" ADD CONSTRAINT "TripAlert_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ochiq reyslarning oxirgi nuqtasi mavjud izdan to'ldiriladi (xarita yangi ustunlardan o'qiydi)
UPDATE "Trip" t SET
  "lastLat" = p."lat", "lastLng" = p."lng", "lastSpeedKmh" = p."speedKmh", "lastHeading" = p."heading",
  "lastAt" = p."at", "lastSeenAt" = p."createdAt"
FROM (
  SELECT DISTINCT ON ("tripId") "tripId", "lat", "lng", "speedKmh", "heading", "at", "createdAt"
  FROM "TripPosition" ORDER BY "tripId", "at" DESC
) p
WHERE p."tripId" = t."id" AND t."status" IN ('LOADED', 'ON_ROAD', 'DELIVERED');
