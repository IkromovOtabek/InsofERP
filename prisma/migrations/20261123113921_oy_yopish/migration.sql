-- Oy yopish (Moliya → Oy yopish): yopilgan bo'lim-oy ro'yxati + yopiq oyga yozishni rad etadigan trigger.

-- CreateTable
CREATE TABLE "PeriodClose" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeriodClose_section_month_key" ON "PeriodClose"("section", "month");

-- Sana qiymatidan oy kaliti ("2026-10"). Prisma DateTime'ni UTC'da saqlaydi — oy zavod vaqti (Asia/Tashkent) bo'yicha.
-- kind = 'month' — ustun allaqachon "YYYY-MM" matn (PayrollRun.month, PayAdjustment.month).
CREATE OR REPLACE FUNCTION insof_period_month(val text, kind text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN val IS NULL OR val = '' THEN NULL
    WHEN kind = 'month' THEN left(val, 7)
    ELSE to_char((val::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')
  END
$$;

-- Umumiy himoya. Argumentlar: 0 — bo'lim, 1 — sana ustuni, 2 — 'ts' | 'month',
-- 3 — 'except' (sanab o'tilgan ustunlardan boshqasi o'zgarsa tekshiriladi) | 'only' (faqat sanab o'tilganlari o'zgarsa),
-- 4 — vergul bilan ustunlar ro'yxati.
-- INSERT/DELETE — har doim tekshiriladi; UPDATE — eski VA yangi sana oyi (yopiq oydan ochiq oyga ko'chirish ham, aksi ham yopiq).
-- Chetlab o'tish (faqat nazorat ostidagi skript/amal uchun): tranzaksiya ichida
--   SELECT set_config('insof.period_bypass', 'on', true);
CREATE OR REPLACE FUNCTION insof_period_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sec  text   := TG_ARGV[0];
  col  text   := TG_ARGV[1];
  kind text   := COALESCE(TG_ARGV[2], 'ts');
  mode text   := COALESCE(TG_ARGV[3], 'except');
  cols text[] := string_to_array(COALESCE(TG_ARGV[4], 'updatedAt'), ',');
  o jsonb;
  n jsonb;
  m text;
BEGIN
  IF current_setting('insof.period_bypass', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Tez yo'l: bu bo'limda birorta ham yopiq oy yo'q
  IF NOT EXISTS (SELECT 1 FROM "PeriodClose" WHERE section = sec) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'INSERT' THEN o := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN n := to_jsonb(NEW); END IF;

  IF TG_OP = 'UPDATE' THEN
    IF mode = 'only' THEN
      IF (SELECT jsonb_object_agg(k, v) FROM jsonb_each(n) AS e(k, v) WHERE k = ANY (cols))
         IS NOT DISTINCT FROM
         (SELECT jsonb_object_agg(k, v) FROM jsonb_each(o) AS e(k, v) WHERE k = ANY (cols)) THEN
        RETURN NEW;
      END IF;
    ELSIF (n - cols) = (o - cols) THEN
      RETURN NEW;
    END IF;
  END IF;

  FOR m IN
    SELECT DISTINCT insof_period_month(x ->> col, kind) FROM (VALUES (o), (n)) AS v(x) WHERE x IS NOT NULL
  LOOP
    IF m IS NOT NULL AND EXISTS (SELECT 1 FROM "PeriodClose" WHERE section = sec AND month = m) THEN
      RAISE EXCEPTION 'INSOF_PERIOD_CLOSED:%:%', sec, m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END
$$;

-- ── Kassa va bank ──
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "CashTransaction" FOR EACH ROW EXECUTE FUNCTION insof_period_guard('kassa', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "CashTransfer"    FOR EACH ROW EXECUTE FUNCTION insof_period_guard('kassa', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "Payment"         FOR EACH ROW EXECUTE FUNCTION insof_period_guard('kassa', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "CashCount"       FOR EACH ROW EXECUTE FUNCTION insof_period_guard('kassa', 'day');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "OpeningBalance"  FOR EACH ROW EXECUTE FUNCTION insof_period_guard('kassa', 'date');

-- ── Sotuv va realizatsiya ── (schyot holati keyingi oydagi to'lov bilan o'zgaradi — status ustuni erkin)
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "RealizationEntry"     FOR EACH ROW EXECUTE FUNCTION insof_period_guard('sotuv', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "RealizationNote"      FOR EACH ROW EXECUTE FUNCTION insof_period_guard('sotuv', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "SalesRegister"        FOR EACH ROW EXECUTE FUNCTION insof_period_guard('sotuv', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "CustomerDebtTransfer" FOR EACH ROW EXECUTE FUNCTION insof_period_guard('sotuv', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "Invoice"              FOR EACH ROW EXECUTE FUNCTION insof_period_guard('sotuv', 'date', 'ts', 'except', 'status,updatedAt');

-- ── Sklad ──
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "StockMove"    FOR EACH ROW EXECUTE FUNCTION insof_period_guard('sklad', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION insof_period_guard('sklad', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "BrigadeMove"  FOR EACH ROW EXECUTE FUNCTION insof_period_guard('sklad', 'date');

-- ── Ishlab chiqarish ──
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProductionBatch"  FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishlab', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProductionReport" FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishlab', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProductDefect"    FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishlab', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "BrigadeShift"     FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishlab', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "TaskProgress"     FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishlab', 'date');

-- ── Logistika ── (reysning faqat hisobga kiradigan ustunlari, yetkazilgan oyi bo'yicha; GPS/ECO holati erkin)
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "LogisticsEntry"   FOR EACH ROW EXECUTE FUNCTION insof_period_guard('logistika', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "LogisticsTx"      FOR EACH ROW EXECUTE FUNCTION insof_period_guard('logistika', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "FuelLog"          FOR EACH ROW EXECUTE FUNCTION insof_period_guard('logistika', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "TransportExpense" FOR EACH ROW EXECUTE FUNCTION insof_period_guard('logistika', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "VehicleService"   FOR EACH ROW EXECUTE FUNCTION insof_period_guard('logistika', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "Trip"             FOR EACH ROW EXECUTE FUNCTION insof_period_guard('logistika', 'deliveredAt', 'ts', 'only', 'deliveredAt,qtyM3,acceptedQty,returnedQty,ttn,driverId,vehicleId,payKm,payAmount,payType,workHours,drumTurns,waitMin');

-- ── Ish haqi va davomat ── (hisoblangan oylik: qayta hisob yopiq, to'lov va tasdiq erkin)
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "Attendance"      FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishhaqi', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "PayAdjustment"   FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishhaqi', 'month', 'month');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "BrigadeHours"    FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishhaqi', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "BrigadeOutput"   FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishhaqi', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "ShiftAssignment" FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishhaqi', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "PayrollRun"      FOR EACH ROW EXECUTE FUNCTION insof_period_guard('ishhaqi', 'month', 'month', 'only', 'month,gross,deductions,net,employerTax');

-- ── Arenda ──
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "RentTx"       FOR EACH ROW EXECUTE FUNCTION insof_period_guard('arenda', 'date');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "RentCharge"   FOR EACH ROW EXECUTE FUNCTION insof_period_guard('arenda', 'month');
CREATE TRIGGER period_guard BEFORE INSERT OR UPDATE OR DELETE ON "RentElecBill" FOR EACH ROW EXECUTE FUNCTION insof_period_guard('arenda', 'month');
