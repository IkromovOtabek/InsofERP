-- Mijoz ilovasi: ish soatlari (hisob uchun), bugun yetkazish chegarasi, Telegram
ALTER TABLE "CompanySettings" ADD COLUMN "openHour" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "CompanySettings" ADD COLUMN "closeHour" INTEGER NOT NULL DEFAULT 18;
ALTER TABLE "CompanySettings" ADD COLUMN "workSunday" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanySettings" ADD COLUMN "sameDayCutoffHour" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "CompanySettings" ADD COLUMN "telegram" TEXT;
