import { db } from "@/lib/db";
import { CASH_LINK_REF } from "@/lib/logistics-finance";

/**
 * Hisob varag'i «jami» uchun: Logistika moliya jurnalidagi, varaq qatorlariga (reys, qo'lda qator, zapravka, transport
 * xarajati) TUSHMAYDIGAN pul — ular qo'shilganda tushum va xarajat ikki marta sanalmaydi:
 *  · kirim — «Transport xizmati» va «Boshqa kirim» (qo'lda yoki kassadan biriktirilgan). Dastavka (zayavka) — varaqda reys
 *    ulushi bo'lib bor; «Obyektda olindi (dastavka)» — o'sha dastavka puli; «Zavod hisobidan o'tkazma» — daromad emas;
 *  · chiqim — mashinaga yozilmagan (transport xarajati yaratilmagan) xarajat: yo'l kira, yollanma texnika, boshqa chiqim.
 *    Yoqilg'i (varaqda norma × narx) va haydovchi haqi (reys narxi) to'lovi — kirmaydi.
 */
export const EXTRA_INCOME = ["Transport xizmati", "Boshqa kirim"] as const;
const SKIP_EXPENSE = ["Yoqilg'i", "Haydovchi haqi"];

export type LedgerExtra = {
  id: string; docNo: string; at: Date; type: "INCOME" | "EXPENSE"; category: string; amount: number;
  account: string; vehicle: string | null; who: string | null; note: string | null; createdBy: string;
};

export async function ledgerExtras(from: Date, to: Date): Promise<{ income: LedgerExtra[]; expense: LedgerExtra[] }> {
  const list = await db.logisticsTx.findMany({
    where: {
      cancelledAt: null, date: { gte: from, lt: to },
      OR: [
        { type: "INCOME", category: { in: [...EXTRA_INCOME] }, OR: [{ refType: null }, { refType: CASH_LINK_REF }] },
        { type: "EXPENSE", transportExpenseId: null, category: { notIn: SKIP_EXPENSE }, OR: [{ refType: null }, { refType: CASH_LINK_REF }] },
      ],
    },
    orderBy: { date: "desc" },
    select: {
      id: true, docNo: true, date: true, type: true, category: true, amount: true, counterparty: true, note: true, vehicleId: true, driverId: true,
      accountId: true, cashTxId: true, createdById: true,
    },
  });
  const ids = (f: (x: (typeof list)[number]) => string | null) => [...new Set(list.map(f).filter((x): x is string => !!x))];
  const [vehs, drvs, accs, cash, users] = await Promise.all([
    db.vehicle.findMany({ where: { id: { in: ids((x) => x.vehicleId) } }, select: { id: true, plate: true } }),
    db.employee.findMany({ where: { id: { in: ids((x) => x.driverId) } }, select: { id: true, fullName: true } }),
    db.logisticsAccount.findMany({ where: { id: { in: ids((x) => x.accountId) } }, select: { id: true, name: true } }),
    db.cashTransaction.findMany({ where: { id: { in: ids((x) => x.cashTxId) } }, select: { id: true, cashAccount: { select: { name: true } } } }),
    db.user.findMany({ where: { id: { in: ids((x) => x.createdById) } }, select: { id: true, fullName: true } }),
  ]);
  const m = <T extends { id: string }>(xs: T[], f: (x: T) => string) => new Map(xs.map((x) => [x.id, f(x)]));
  const plate = m(vehs, (v) => v.plate), drv = m(drvs, (d) => d.fullName), acc = m(accs, (a) => a.name), ca = m(cash, (c) => c.cashAccount.name), usr = m(users, (u) => u.fullName);
  const rows: LedgerExtra[] = list.map((x) => ({
    id: x.id, docNo: x.docNo, at: x.date, type: x.type === "INCOME" ? "INCOME" : "EXPENSE", category: x.category, amount: Number(x.amount),
    account: (x.accountId ? acc.get(x.accountId) : null) ?? (x.cashTxId ? ca.get(x.cashTxId) : null) ?? "—",
    vehicle: x.vehicleId ? plate.get(x.vehicleId) ?? null : null,
    who: (x.driverId ? drv.get(x.driverId) : null) ?? x.counterparty, note: x.note, createdBy: usr.get(x.createdById) ?? "—",
  }));
  return { income: rows.filter((r) => r.type === "INCOME"), expense: rows.filter((r) => r.type === "EXPENSE") };
}
