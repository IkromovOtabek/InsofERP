import { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { ELEC_PAID, ensureCharge, monthKey } from "./rent";

/**
 * Arenda — svet hisobi (sekretarning «Свет отчёт» Excel daftari o'rnida). Ijara qarzidan ALOHIDA yuritiladi.
 *
 *  · Har oy, joy (bozor) bo'yicha: avvalgi va hozirgi ko'rsatkich → farqi (kVt) → narxi = farq × 1 kVt narxi
 *    (`CompanySettings.rentKwhPrice`) → ustama = narxi × % (`rentElecMarkup`, hammaga bir xil) → summasi = narxi + ustama.
 *    Hisoblagichsiz (yoki ko'rsatkich o'zgarmagan) joyda summasi qo'lda — sukut bo'yicha shartnomadagi qat'iy summa.
 *  · Berilgan = arenda kassasiga «Svet to'lovi» kirimlari (naqd / perechisleniye, kvitansiya bilan) + ijarachi elektr
 *    kompaniyasining litsevoy hisobiga o'zi to'lagani (`elecPaidDirect`, kassaga kirmaydi).
 *  · Qoldiq = summasi − berilgan (manfiy — ortiqcha to'lagan). Svet qarzi shartnoma bo'yicha, oylar yig'indisi.
 *  · «To'lashimiz kerak» — joy bo'yicha elektr kompaniyasiga oylik to'lov (`RentElecBill`); to'lash — «Svet» chiqimi.
 */

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Svet tarifi va ustama (%), korxona sozlamasidan. */
export async function elecSettings() {
  const c = await db.companySettings.findUnique({ where: { id: "main" }, select: { rentKwhPrice: true, rentElecMarkup: true } });
  return { kwhPrice: n(c?.rentKwhPrice), markup: n(c?.rentElecMarkup) };
}

/**
 * Ko'rsatkichlardan hisob: farqi musbat bo'lsa — narxi va ustama hisoblanadi; aks holda (hisoblagichsiz yoki o'zgarmagan)
 * summasi qo'lda (`manual`). Narx va ustama so'mgacha yaxlitlanadi (Excel'dagidek butun so'm).
 */
export function elecCalc(start: number | null, end: number | null, manual: number, s: { kwhPrice: number; markup: number }) {
  const kwh = start != null && end != null && end >= start ? r2(end - start) : 0;
  if (kwh > 0 && s.kwhPrice > 0) {
    const price = Math.round(kwh * s.kwhPrice), extra = Math.round((price * s.markup) / 100);
    return { kwh, price, extra, sum: price + extra, metered: true };
  }
  return { kwh, price: 0, extra: 0, sum: r2(manual), metered: false };
}

export type ElecRow = {
  chargeId: string; shopId: string; leaseId: string; name: string; tenantName: string | null; former: boolean; location: string;
  meterStart: number | null; meterEnd: number | null; kwh: number; price: number; extra: number; sum: number; metered: boolean;
  fixed: number; paidCash: number; paidBank: number; paidDirect: number; paid: number; left: number; note: string | null;
};
type SumKey = "kwh" | "price" | "extra" | "sum" | "fixed" | "paid" | "left";
export type ElecGroup = { location: string; rows: ElecRow[]; total: Record<SumKey, number>; bill: number | null; billNote: string | null };
const ZERO: Record<SumKey, number> = { kwh: 0, price: 0, extra: 0, sum: 0, fixed: 0, paid: 0, left: 0 };

/**
 * Oyning svet varag'i: svet hisobidagi do'konlar (yoki shu oy svet summasi / litsevoy to'lovi bor qatorlar), joy bo'yicha guruh,
 * har guruhda jami va «To'lashimiz kerak». Qator — shartnomaning shu oy hisobi.
 */
export async function elecSheet(month: Date) {
  const [s, charges, paid, bills] = await Promise.all([
    elecSettings(),
    db.rentCharge.findMany({
      where: { month, OR: [{ shop: { electricityBilled: true } }, { elecDue: { gt: 0 } }, { elecPaidDirect: { gt: 0 } }] },
      include: { shop: true, lease: { select: { tenantName: true, status: true } } },
    }),
    db.rentTx.groupBy({ by: ["leaseId", "method"], where: { ...ELEC_PAID, month, leaseId: { not: null } }, _sum: { amount: true } }),
    db.rentElecBill.findMany({ where: { month } }),
  ]);
  const paidBy = new Map<string, { CASH: number; BANK: number }>();
  for (const p of paid) {
    const cur = paidBy.get(p.leaseId!) ?? { CASH: 0, BANK: 0 };
    cur[p.method] += n(p._sum.amount);
    paidBy.set(p.leaseId!, cur);
  }
  const rows: ElecRow[] = charges
    .sort((a, b) => a.shop.sortOrder - b.shop.sortOrder || a.shop.createdAt.getTime() - b.shop.createdAt.getTime() || Number(a.lease.status === "ACTIVE") - Number(b.lease.status === "ACTIVE"))
    .map((c) => {
      const start = c.meterStart != null ? n(c.meterStart) : null, end = c.meterEnd != null ? n(c.meterEnd) : null;
      const kwh = start != null && end != null && end >= start ? r2(end - start) : 0;
      // Hisoblagich bo'yicha: summasi = narxi + ustama (summasi narxdan kichik bo'lmaydi); aks holda qo'lda/shartnoma summasi
      const sum = n(c.elecDue), price = n(c.electricity), metered = kwh > 0 && price > 0 && sum >= price;
      const p = paidBy.get(c.leaseId) ?? { CASH: 0, BANK: 0 }, direct = n(c.elecPaidDirect);
      const paidAll = r2(p.CASH + p.BANK + direct);
      return {
        chargeId: c.id, shopId: c.shopId, leaseId: c.leaseId, name: c.shop.name, tenantName: c.lease.tenantName, former: c.lease.status !== "ACTIVE",
        location: c.shop.location, meterStart: start, meterEnd: end, kwh, price: metered ? price : 0, extra: metered ? r2(sum - price) : 0, sum, metered,
        fixed: n(c.elecFixed), paidCash: p.CASH, paidBank: p.BANK, paidDirect: direct, paid: paidAll, left: r2(sum - paidAll), note: c.elecNote,
      };
    });
  const groups: ElecGroup[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.location === r.location);
    if (!g) {
      const b = bills.find((x) => x.location === r.location);
      g = { location: r.location, rows: [], total: { ...ZERO }, bill: b ? n(b.amount) : null, billNote: b?.note ?? null };
      groups.push(g);
    }
    g.rows.push(r);
  }
  const sum = (xs: ElecRow[]) => { const t = { ...ZERO }; for (const r of xs) for (const k of Object.keys(t) as SumKey[]) t[k] = r2(t[k] + r[k]); return t; };
  for (const g of groups) g.total = sum(g.rows);
  return { settings: s, groups, total: sum(rows), bill: groups.reduce((a, g) => a + (g.bill ?? 0), 0) };
}

/** Shartnomalar bo'yicha svet qarzi (barcha oylar): summalar − kassaga svet to'lovlari − litsevoyga to'langan. */
export async function leaseElecDebts(leaseIds?: string[]): Promise<Map<string, number>> {
  const where = leaseIds ? { leaseId: { in: leaseIds } } : {};
  const [due, paid] = await Promise.all([
    db.rentCharge.groupBy({ by: ["leaseId"], where, _sum: { elecDue: true, elecPaidDirect: true } }),
    db.rentTx.groupBy({ by: ["leaseId"], where: { ...ELEC_PAID, leaseId: leaseIds ? { in: leaseIds } : { not: null } }, _sum: { amount: true } }),
  ]);
  const m = new Map<string, number>();
  for (const d of due) m.set(d.leaseId, r2(n(d._sum.elecDue) - n(d._sum.elecPaidDirect)));
  for (const p of paid) m.set(p.leaseId!, r2((m.get(p.leaseId!) ?? 0) - n(p._sum.amount)));
  return m;
}

export type ElecLedgerMonth = { key: string; month: Date; kwh: number; sum: number; paid: number; left: number };

/** Shartnomaning svet hisobi oylar bo'yicha (yangi oy tepada) — do'kon kartasi uchun. */
export async function elecLedger(leaseId: string) {
  const [charges, paid] = await Promise.all([
    db.rentCharge.findMany({ where: { leaseId, OR: [{ elecDue: { gt: 0 } }, { elecPaidDirect: { gt: 0 } }, { meterEnd: { not: null } }] }, orderBy: { month: "desc" } }),
    db.rentTx.groupBy({ by: ["month"], where: { ...ELEC_PAID, leaseId }, _sum: { amount: true } }),
  ]);
  const paidBy = new Map(paid.filter((p) => p.month).map((p) => [monthKey(p.month!), n(p._sum.amount)]));
  const months: ElecLedgerMonth[] = charges.map((c) => {
    const key = monthKey(c.month), p = r2((paidBy.get(key) ?? 0) + n(c.elecPaidDirect));
    paidBy.delete(key);
    const kwh = c.meterStart != null && c.meterEnd != null ? Math.max(0, n(c.meterEnd) - n(c.meterStart)) : 0;
    return { key, month: c.month, kwh, sum: n(c.elecDue), paid: p, left: r2(n(c.elecDue) - p) };
  });
  for (const [key, p] of paidBy) {
    const [y, m] = key.split("-").map(Number);
    months.push({ key, month: new Date(Date.UTC(y, m - 1, 1)), kwh: 0, sum: 0, paid: p, left: r2(-p) });
  }
  months.sort((a, b) => b.month.getTime() - a.month.getTime());
  const debt = r2(months.reduce((a, m) => a + m.left, 0));
  return { months, debt };
}

/**
 * Svet varag'idagi qatorni yozish: ko'rsatkichlar, (hisoblagichsiz bo'lsa) summa, litsevoyga to'langan va izoh.
 * Shartnomaning shu oy hisobi bo'lmasa — ijara hisobi bilan birga ochiladi.
 */
export async function saveRentElecData(leaseId: string, month: Date, d: {
  meterStart: number | null; meterEnd: number | null; amount: number; paidDirect: number; note: string | null;
}, userId: string): Promise<{ error?: string; sum?: number }> {
  if (d.meterStart != null && d.meterEnd != null && d.meterEnd < d.meterStart) return { error: "Hozirgi ko'rsatkich avvalgisidan kichik bo'lmasin" };
  const lease = await db.rentLease.findUnique({ where: { id: leaseId }, select: { id: true } });
  if (!lease) return { error: "Shartnoma topilmadi" };
  const s = await elecSettings();
  const calc = elecCalc(d.meterStart, d.meterEnd, d.amount, s);
  if (calc.kwh > 0 && !(s.kwhPrice > 0)) return { error: "Avval 1 kVt narxini kiriting (shu sahifadagi «Svet tarifi»)" };
  const res = await db.$transaction(async (tx) => {
    const before = await ensureCharge(tx, leaseId, month);
    const after = await tx.rentCharge.update({
      where: { id: before.id },
      data: { meterStart: d.meterStart, meterEnd: d.meterEnd, electricity: calc.price, elecDue: calc.sum, elecPaidDirect: d.paidDirect, elecNote: d.note },
    });
    await audit(tx, userId, "UPDATE", "RentCharge", after.id, before, after);
    return calc.sum;
  });
  return { sum: res };
}

/** Joy bo'yicha elektr kompaniyasiga oylik to'lov («To'lashimiz kerak»); 0 — o'chiriladi. */
export async function saveElecBill(location: string, month: Date, amount: number, note: string | null, userId: string) {
  const before = await db.rentElecBill.findUnique({ where: { location_month: { location, month } } });
  if (!(amount > 0)) {
    if (before) {
      await db.rentElecBill.delete({ where: { id: before.id } });
      await audit(db, userId, "DELETE", "RentElecBill", before.id, before, undefined);
    }
    return;
  }
  const b = await db.rentElecBill.upsert({ where: { location_month: { location, month } }, create: { location, month, amount, note }, update: { amount, note } });
  await audit(db, userId, before ? "UPDATE" : "CREATE", "RentElecBill", b.id, before ?? undefined, b);
}
