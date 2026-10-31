-- Korxona tarifi: o'chirilgan qo'shimcha modullar va faol foydalanuvchilar chegarasi. Sukut — hammasi yoqiq, cheklovsiz.
-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "modulesOff" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "userLimit" INTEGER;

