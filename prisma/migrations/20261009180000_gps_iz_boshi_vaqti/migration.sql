-- Reys izining birinchi nuqtasi vaqti — yakunda saqlanadi (oxirgisi Trip.lastAt da). 90 kunlik tozalashdan
-- keyin ham /trip-track reys boshi va oxirini to'g'ri ko'rsatsin. Kengaytiruvchi: faqat yangi ustun.

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "trackFirstAt" TIMESTAMP(3);

-- Mavjud yakunlar: nuqtalar hali bor — birinchisidan, bo'lmasa oxirgi nuqta − umumiy vaqt
UPDATE "Trip" t SET "trackFirstAt" = p.first
FROM (SELECT "tripId", MIN("at") AS first FROM "TripPosition" GROUP BY "tripId") p
WHERE p."tripId" = t."id" AND t."summaryAt" IS NOT NULL AND t."trackFirstAt" IS NULL;

UPDATE "Trip" SET "trackFirstAt" = "lastAt" - ("totalSec" * INTERVAL '1 second')
WHERE "summaryAt" IS NOT NULL AND "trackFirstAt" IS NULL AND "lastAt" IS NOT NULL AND "totalSec" IS NOT NULL AND "trackPoints" > 0;
