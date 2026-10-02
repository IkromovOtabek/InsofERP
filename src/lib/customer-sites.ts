import { db } from "./db";

/**
 * Mijoz obyektlari (Site) bo'yicha qarz — mijoz kartasidagi "Obyektlar" bo'limi uchun.
 *
 * `src/lib/finance.ts` dagi umumiy qarz qoidasiga mos (faqat o'qib, uslubga moslab yozildi), lekin
 * bu yerda hamma narsa zayavkaning obyektiga (Order.siteId) bo'yicha guruhlanadi:
 *
 *   yozilgan  = bekor qilinmagan schyotlar (shu obyekt zayavkalariga tegishli)
 *   to'langan = shu obyekt zayavkalariga kelgan to'lovlar (schyot orqali yoki avans; Realizatsiya emas)
 *   ochiq     = schyot yozilmagan tasdiqlangan zayavkalarning mahsulot summasi
 *   qarz(net) = yozilgan − to'langan + ochiq   (avans bir tomonda qo'shilib, ikkinchisida ayrilib ketadi)
 *
 * Obyektga bog'lanmagan (siteId = null) zayavka/schyot/to'lov — "Obyektsiz" guruhida (site = null).
 * Realizatsiya jurnali to'lovlari (register) hisobga olinmaydi — ular ERP schyotlariga tegmaydi.
 */

/** Ochiq (schyot yozilmagan) zayavka holatlari — finance.ts dagi `openOrderWhere` bilan bir xil. */
const OPEN_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"] as const;

export type SiteDebt = {
  /** null — "Obyektsiz" guruh (siteId yo'q zayavkalar/to'lovlar). */
  site: {
    id: string;
    name: string;
    address: string;
    contactName: string | null;
    contactPhone: string | null;
    deliveryHours: string | null;
    instructions: string | null;
    isActive: boolean;
  } | null;
  invoiced: number; // yozilgan schyotlar
  paid: number; // to'langan
  open: number; // schyot yozilmagan ochiq zayavkalar summasi
  net: number; // yozilgan − to'langan + ochiq (manfiy bo'lishi mumkin — ortiqcha to'lov)
  debt: number; // max(0, net)
  orders: number; // obyektga tegishli (SALE) zayavkalar soni
  canDelete: boolean; // obyektda zayavka yo'q bo'lsa o'chirsa bo'ladi
};

const itemsSum = (items: { qtyM3: unknown; price: unknown }[]) =>
  items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);

/** Mijozning har bir obyekti bo'yicha qarz. Obyektsiz zayavka/to'lov bo'lsa — oxirida "Obyektsiz" guruh. */
export async function siteDebts(customerId: string): Promise<SiteDebt[]> {
  const [sites, orders, payments] = await Promise.all([
    db.site.findMany({
      where: { customerId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, address: true, contactName: true, contactPhone: true, deliveryHours: true, instructions: true, isActive: true },
    }),
    // Mijozning barcha sotuv zayavkalari: obyekti, holati, mahsulot summasi va bekor qilinmagan schyotlari
    db.order.findMany({
      where: { customerId, kind: "SALE" },
      select: {
        siteId: true,
        status: true,
        items: { select: { qtyM3: true, price: true } },
        invoices: { where: { status: { not: "CANCELLED" } }, select: { amount: true } },
      },
    }),
    // Mijozning to'lovlari (Realizatsiya jurnalidan tashqari) — obyekti schyot yoki zayavka orqali topiladi
    db.payment.findMany({
      where: { customerId, register: { is: null } },
      select: { amount: true, order: { select: { siteId: true } }, invoice: { select: { order: { select: { siteId: true } } } } },
    }),
  ]);

  // Guruh kaliti: siteId (null = "Obyektsiz")
  const invoiced = new Map<string | null, number>();
  const open = new Map<string | null, number>();
  const paid = new Map<string | null, number>();
  const orderCount = new Map<string | null, number>();
  const add = (m: Map<string | null, number>, k: string | null, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const o of orders) {
    const k = o.siteId ?? null;
    add(orderCount, k, 1);
    const inv = o.invoices.reduce((s, i) => s + Number(i.amount), 0);
    add(invoiced, k, inv);
    // Schyot yozilmagan ochiq zayavka — mahsulot summasi (schyotsiz ochiq zayavka)
    if (o.invoices.length === 0 && (OPEN_STATUSES as readonly string[]).includes(o.status)) add(open, k, itemsSum(o.items));
  }
  for (const p of payments) {
    const k = p.order?.siteId ?? p.invoice?.order?.siteId ?? null;
    add(paid, k, Number(p.amount));
  }

  const build = (key: string | null, site: SiteDebt["site"]): SiteDebt => {
    const inv = invoiced.get(key) ?? 0;
    const pd = paid.get(key) ?? 0;
    const op = open.get(key) ?? 0;
    const net = inv - pd + op;
    const n = orderCount.get(key) ?? 0;
    return { site, invoiced: inv, paid: pd, open: op, net, debt: Math.max(0, net), orders: n, canDelete: site !== null && n === 0 };
  };

  const out: SiteDebt[] = sites.map((s) => build(s.id, s));
  // "Obyektsiz" guruh — faqat obyektsiz zayavka/to'lov bo'lsa ko'rsatiladi
  if ((orderCount.get(null) ?? 0) > 0 || (invoiced.get(null) ?? 0) > 0 || (paid.get(null) ?? 0) > 0 || (open.get(null) ?? 0) > 0) {
    out.push(build(null, null));
  }
  return out;
}
