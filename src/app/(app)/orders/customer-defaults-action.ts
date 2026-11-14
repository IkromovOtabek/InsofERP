"use server";

import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { noteInfo } from "@/lib/order-day-sheet";
import { withoutNds } from "@/lib/nds";

/**
 * Mijoz tanlanganda zayavka qatoriga tushadigan ma'lumot («Excel ko'rinish» varag'i): qabul qiluvchi, telefon, obyekt
 * (oxirgi zayavkadagi) va har mahsulotning shu mijozga oxirgi narxi (QQS'siz). Manba tartibi: oxirgi zayavka izohidagi
 * «Qabul qiluvchi» → obyekt kontakti → mijoz kartasi (mas'ul shaxs, telefon).
 */
export type CustomerDefaults = {
  receiver: string | null; phone: string | null;
  /** Oxirgi zayavka obyekti (faol bo'lsa) — mijoz obyektlari ro'yxatidagi id */
  siteId: string | null;
  /** Oxirgi zayavka: raqami va sanasi (ISO) — katak ostidagi izoh uchun */
  last: { orderNo: string; date: string } | null;
  /** mahsulot id → shu mijozga oxirgi narx (QQS'siz) */
  prices: Record<string, number>;
};

export async function customerDefaults(customerId: string): Promise<CustomerDefaults | null> {
  const s = await requirePage("/orders");
  if (!canDo(s, "orders", "excel") && !canDo(s, "orders", "create")) return null;
  if (typeof customerId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(customerId)) return null;
  const [c, orders] = await Promise.all([
    db.customer.findUnique({ where: { id: customerId }, select: { phone: true, contactPerson: true } }),
    db.order.findMany({
      where: { customerId, kind: "SALE", status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 30,
      select: {
        orderNo: true, deliveryDate: true, note: true,
        site: { select: { id: true, isActive: true, contactName: true, contactPhone: true } },
        items: { select: { productId: true, price: true, nds: true } },
      },
    }),
  ]);
  if (!c) return null;
  const last = orders[0] ?? null;
  const ni = noteInfo(last?.note ?? null);
  const prices: Record<string, number> = {};
  for (const o of orders) for (const i of o.items) {
    if (i.productId in prices) continue; // eng yangi zayavkadagisi
    prices[i.productId] = i.nds ? withoutNds(Number(i.price)) : Number(i.price);
  }
  return {
    receiver: ni.receiver || last?.site?.contactName || c.contactPerson || null,
    phone: ni.phone || last?.site?.contactPhone || c.phone || null,
    siteId: last?.site?.isActive ? last.site.id : null,
    last: last ? { orderNo: last.orderNo, date: last.deliveryDate.toISOString() } : null,
    prices,
  };
}
