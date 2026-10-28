import { db } from "./db";
import { audit } from "./audit";
import { orderTotal } from "@/lib/order-total";

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
    lat: number | null;
    lng: number | null;
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


/** Mijozning har bir obyekti bo'yicha qarz. Obyektsiz zayavka/to'lov bo'lsa — oxirida "Obyektsiz" guruh. */
export async function siteDebts(customerId: string): Promise<SiteDebt[]> {
  const [sites, orders, payments] = await Promise.all([
    db.site.findMany({
      where: { customerId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, address: true, lat: true, lng: true, contactName: true, contactPhone: true, deliveryHours: true, instructions: true, isActive: true },
    }),
    // Mijozning barcha sotuv zayavkalari: obyekti, holati, mahsulot summasi va bekor qilinmagan schyotlari
    db.order.findMany({
      where: { customerId, kind: "SALE" },
      select: {
        siteId: true,
        status: true,
        deliveryFee: true,
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
    if (o.invoices.length === 0 && (OPEN_STATUSES as readonly string[]).includes(o.status)) add(open, k, orderTotal(o));
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

// ───────────────────────── Obyektni saqlash / o'chirish (mijoz kartasi) ─────────────────────────
// Veb (`customers/site-actions.ts`) va mobil ilova (`lib/mobile/sotuv-extra.ts`) shu yerdan chaqiradi; ruxsat chaqiruvchida.

export type SiteInput = {
  name: string;
  address: string;
  /** Xaritadagi nuqta: veb forma doim yuboradi (null — olib tashlandi), mobil yubormaydi — o'zgarmaydi. */
  lat?: number | null;
  lng?: number | null;
  contactName: string | null;
  contactPhone: string | null;
  deliveryHours: string | null;
  instructions: string | null;
  isActive: boolean;
};
export type SiteResult = { ok: true; id: string } | { ok: false; error: string };

/** Obyekt qo'shish (`id` = null) yoki tahrirlash — tahrirda obyekt shu mijozniki ekani tekshiriladi. */
export async function saveCustomerSite(customerId: string, id: string | null, d: SiteInput, userId: string): Promise<SiteResult> {
  if (!d.name.trim()) return { ok: false, error: "Obyekt nomi to'ldirilishi shart" };
  if (!d.address.trim()) return { ok: false, error: "Manzil to'ldirilishi shart" };
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) return { ok: false, error: "Mijoz topilmadi" };
  let savedId = id;
  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.site.findUnique({ where: { id } });
        if (!before || before.customerId !== customerId) throw new Error("NOT_OWNER");
        const after = await tx.site.update({ where: { id }, data: d });
        await audit(tx, userId, "UPDATE", "Site", id, before, after);
        // Nuqta qo'yilsa — shu obyektning nuqtasiz ochiq zayavkalari ham to'ladi (Logistika → Obyektlar bilan bir xil)
        if (d.lat != null && d.lng != null) {
          await tx.order.updateMany({ where: { siteId: id, lat: null, status: { in: ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION"] } }, data: { lat: d.lat, lng: d.lng } });
        }
      } else {
        const c = await tx.site.create({ data: { ...d, customerId } });
        await audit(tx, userId, "CREATE", "Site", c.id, undefined, c);
        savedId = c.id;
      }
    });
  } catch (e) {
    if (String(e).includes("NOT_OWNER")) return { ok: false, error: "Bu obyekt boshqa mijozga tegishli" };
    throw e;
  }
  return { ok: true, id: savedId! };
}

/** Faqat zayavkasi yo'q obyektni o'chirsa bo'ladi — aks holda tarix uziladi ("Faol emas" qilinadi). */
export async function deleteCustomerSite(customerId: string, id: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const site = await db.site.findUnique({ where: { id }, select: { customerId: true } });
  if (!site || site.customerId !== customerId) return { ok: false, error: "Obyekt topilmadi" };
  const orders = await db.order.count({ where: { siteId: id } });
  if (orders > 0) return { ok: false, error: `Bu obyektda ${orders} ta zayavka bor — o'chirib bo'lmaydi. O'rniga "Faol emas" qiling.` };
  await db.$transaction(async (tx) => {
    const before = await tx.site.findUnique({ where: { id } });
    await tx.site.delete({ where: { id } });
    await audit(tx, userId, "DELETE", "Site", id, before, undefined);
  });
  return { ok: true };
}
