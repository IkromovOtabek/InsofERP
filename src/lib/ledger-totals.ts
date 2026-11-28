import type { LedgerRow, LedgerTotals } from "@/lib/driver-ledger";

/**
 * Hisob varag'i jami va haydovchi jamlanmasi — bazaga murojaatsiz, brauzerda ham ishlaydi: varaqdagi ustun filtrlari
 * (`logistika/tabel/ledger-sheet.tsx`) jami qatorini ko'rinib turgan qatorlardan qayta hisoblaydi. `lib/driver-ledger.ts`
 * shu funksiyalarni qayta eksport qiladi.
 */

/** Jami uchun yetadigan ustunlar (varaqqa tahrir ma'lumoti — `refs`, `src` — yuborilmaydi). */
type SumRow = Pick<LedgerRow, "trips" | "km" | "workHours" | "refuel" | "fuelSum" | "drumUse" | "unit" | "use" | "useExtra" | "pay" | "repair" | "parts" | "vulc" | "other" | "fuelCost" | "extCost" | "total"
  | "revBank" | "revCash" | "revDebt" | "svcBank" | "svcCash" | "revOther" | "revenue" | "profit">;

/** Qatorlar jami (mashina varag'i yoki hammasi uchun). */
export function ledgerTotals(rows: SumRow[]): LedgerTotals {
  const total: LedgerTotals = {
    rows: rows.length, trips: 0, km: 0, hours: 0, useGas: 0, useDt: 0, drumUse: 0, refuel: 0, fuelSum: 0, pay: 0, repair: 0, parts: 0, vulc: 0, other: 0, fuelCost: 0, extCost: 0, total: 0,
    revBank: 0, revCash: 0, revDebt: 0, svcBank: 0, svcCash: 0, revOther: 0, revenue: 0, profit: 0,
  };
  for (const r of rows) {
    total.trips += r.trips; total.km += r.km; total.hours += r.workHours ?? 0; total.refuel += r.refuel; total.fuelSum += r.fuelSum; total.drumUse += r.drumUse ?? 0;
    if (r.unit === "m³") total.useGas += r.use ?? 0; else total.useDt += r.use ?? 0;
    total.useDt += r.useExtra ?? 0;
    total.pay += r.pay; total.repair += r.repair; total.parts += r.parts; total.vulc += r.vulc; total.other += r.other; total.fuelCost += r.fuelCost; total.extCost += r.extCost; total.total += r.total;
    total.revBank += r.revBank; total.revCash += r.revCash; total.revDebt += r.revDebt; total.svcBank += r.svcBank; total.svcCash += r.svcCash;
    total.revOther += r.revOther; total.revenue += r.revenue; total.profit += r.profit;
  }
  return total;
}

/** Varaq ostidagi jamlanma (Excel'dagi ISMI / OYLIK / NAXT): haydovchi bo'yicha haq — oylik, naqd va hali narxsiz (taklif). */
export type DriverPaySum = { driverId: string; driver: string; payroll: number; cash: number; suggested: number; total: number };

export function driverPaySums(rows: Pick<LedgerRow, "driverId" | "driver" | "pay" | "amount" | "payType">[]): DriverPaySum[] {
  const out = new Map<string, DriverPaySum>();
  for (const r of rows) {
    if (!r.driverId || r.pay <= 0) continue;
    const d = out.get(r.driverId) ?? { driverId: r.driverId, driver: r.driver ?? "—", payroll: 0, cash: 0, suggested: 0, total: 0 };
    if (r.amount == null) d.suggested += r.pay; else if (r.payType === "CASH") d.cash += r.pay; else d.payroll += r.pay;
    d.total += r.pay;
    out.set(r.driverId, d);
  }
  return [...out.values()].sort((a, b) => b.total - a.total);
}
