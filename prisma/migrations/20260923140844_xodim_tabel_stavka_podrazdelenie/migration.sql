-- Otdel kadr: buxgalteriya tabeli ustunlari (Excel import shu maydonlarga tushadi)
ALTER TABLE "Employee" ADD COLUMN     "firedAt" TIMESTAMP(3),
ADD COLUMN     "subdivision" TEXT,
ADD COLUMN     "tabelNo" TEXT,
ADD COLUMN     "tariffRate" DECIMAL(18,2);
