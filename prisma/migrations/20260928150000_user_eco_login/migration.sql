-- ECO ilovasida ro'yxatdan o'tgan foydalanuvchiga ERP'ga kirish ruxsati (telefon + ilova paroli)
ALTER TABLE "User" ADD COLUMN "ecoUserId" TEXT;
CREATE UNIQUE INDEX "User_ecoUserId_key" ON "User"("ecoUserId");
