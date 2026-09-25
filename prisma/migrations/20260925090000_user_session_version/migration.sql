-- Sessiya versiyasi: parol almashganda yoki hisob yopilganda oshiriladi,
-- eski veb cookie va mobil tokenlar (sv mos kelmagani uchun) darhol yaroqsiz bo'ladi.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
