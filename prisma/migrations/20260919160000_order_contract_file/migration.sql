-- Didox'da imzolangan shartnoma fayli tizimga yuklanadi (isbot). Fayl diskda uploads/contracts/ da, bazada nomi.
ALTER TABLE "Order" ADD COLUMN "contractFile" TEXT;
ALTER TABLE "Order" ADD COLUMN "contractFileName" TEXT;
ALTER TABLE "Order" ADD COLUMN "contractFileType" TEXT;
ALTER TABLE "Order" ADD COLUMN "contractFileAt" TIMESTAMP(3);
