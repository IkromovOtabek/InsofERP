import { db } from "@/lib/db";
import { ndsPart, withoutNds } from "@/lib/nds";
import { unitLabel } from "@/lib/unit";

/**
 * «Realizatsiya zayavkasi» — bir kunga yetkaziladigan zayavkalar Excel varag'i ko'rinishida
 * (Zayavka → haftalik ish tartibi → kun kartasini 2 marta bosish → `/orders/kun/<sana>`).
 *
 * Bloklar to'lov turi bo'yicha: qarzga (`onCredit`) → «Qarz», `payMethod` BANK → «Perechisleniye»,
 * CASH → «Naqd». To'lov usuli kiritilmagan eski zayavka: NDS'li qatori bo'lsa perechisleniye, aks holda naqd.
 *
 * Summalar `lib/order-total.ts` qoidasiga mos: qator jami = miqdor × narx (narxda NDS bor), dastavka
 * zayavkaning birinchi qatoriga yoziladi va QQSsiz summaga qo'shiladi — blok va umumiy «Jami» zayavka
 * summalari yig'indisiga teng chiqadi. Sklad zaxirasi (STOCK) va bekor qilingan zayavkalar kirmaydi.
 */

export type PayGroupKey = "BANK" | "CASH" | "DEBT";
export const PAY_GROUPS: { key: PayGroupKey; label: string }[] = [
  { key: "BANK", label: "Perechisleniye" },
  { key: "CASH", label: "Naqd" },
  { key: "DEBT", label: "Qarz (tekin)" },
];

export type DaySheetRow = {
  orderId: string; orderNo: string; customer: string; product: string; unit: string;
  qty: number; price: number; delivery: number; net: number; vat: number; total: number;
  receiver: string | null; phone: string | null; site: string; time: string | null;
};
export type DaySheetTotals = { qty: number; delivery: number; net: number; vat: number; total: number };
export type DaySheetGroup = { key: PayGroupKey; label: string; rows: DaySheetRow[]; totals: DaySheetTotals; qtyText: string };
export type DaySheet = {
  groups: DaySheetGroup[];
  products: { name: string; unit: string; qty: number }[];
  grand: DaySheetTotals;
  orderCount: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const sumOf = (rows: DaySheetRow[]): DaySheetTotals => rows.reduce(
  (s, r) => ({ qty: s.qty + r.qty, delivery: s.delivery + r.delivery, net: r2(s.net + r.net), vat: r2(s.vat + r.vat), total: r2(s.total + r.total) }),
  { qty: 0, delivery: 0, net: 0, vat: 0, total: 0 },
);
/** Blokdagi miqdor: bitta birlik bo'lsa «212 m³», aralash bo'lsa «212 m³ · 45 dona» (m³ va dona qo'shilmaydi). */
function qtyText(rows: DaySheetRow[]): string {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.unit, (m.get(r.unit) ?? 0) + r.qty);
  return [...m].map(([u, q]) => `${+q.toFixed(3)} ${u}`).join(" · ");
}

export async function orderDaySheet(day: Date): Promise<DaySheet> {
  const from = new Date(day); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);

  const [orders, groups] = await Promise.all([
    db.order.findMany({
      where: { kind: "SALE", status: { not: "CANCELLED" }, dateUnknown: false, deliveryDate: { gte: from, lt: to } },
      orderBy: [{ deliveryTime: "asc" }, { orderNo: "asc" }],
      select: {
        id: true, orderNo: true, deliveryTime: true, deliveryAddress: true, deliveryFee: true, payMethod: true, onCredit: true,
        customer: { select: { name: true, phone: true, contactPerson: true } },
        site: { select: { name: true, contactName: true, contactPhone: true } },
        items: { orderBy: { id: "asc" }, select: { qtyM3: true, price: true, nds: true, product: { select: { name: true, unit: true, groupId: true } } } },
      },
    }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);

  // Mahsulot bo'yicha jami — eng yuqori papka nomi bilan (har korxonada papkalar o'zicha)
  const gBy = new Map(groups.map((g) => [g.id, g]));
  const rootName = (id: string | null) => {
    let g = id ? gBy.get(id) : undefined;
    while (g?.parentId && gBy.get(g.parentId)) g = gBy.get(g.parentId);
    return g?.name ?? "Boshqa";
  };
  const products = new Map<string, { name: string; unit: string; qty: number }>();

  const rowsBy: Record<PayGroupKey, DaySheetRow[]> = { BANK: [], CASH: [], DEBT: [] };
  for (const o of orders) {
    const key: PayGroupKey = o.onCredit ? "DEBT"
      : o.payMethod ? (o.payMethod === "BANK" ? "BANK" : "CASH")
      : o.items.some((i) => i.nds) ? "BANK" : "CASH";
    const fee = Number(o.deliveryFee);
    o.items.forEach((i, n) => {
      const qty = Number(i.qtyM3), price = Number(i.price);
      const line = r2(qty * price);
      const vat = i.nds ? ndsPart(line) : 0;
      const delivery = n === 0 ? fee : 0;
      const unit = unitLabel(i.product.unit);
      rowsBy[key].push({
        orderId: o.id, orderNo: o.orderNo, customer: o.customer.name, product: i.product.name, unit,
        qty, price: i.nds ? withoutNds(price) : price, delivery,
        net: r2(line - vat + delivery), vat, total: r2(line + delivery),
        receiver: o.site?.contactName || o.customer.contactPerson || null,
        phone: o.site?.contactPhone || o.customer.phone || null,
        site: o.site?.name || o.deliveryAddress, time: o.deliveryTime,
      });
      const pk = `${rootName(i.product.groupId)}|${unit}`;
      const p = products.get(pk) ?? { name: rootName(i.product.groupId), unit, qty: 0 };
      p.qty += qty; products.set(pk, p);
    });
    // Mahsulot qatorisiz zayavka (faqat dastavka) ham varaqda ko'rinsin — summasi jamiga kiradi
    if (o.items.length === 0 && fee > 0) {
      rowsBy[key].push({
        orderId: o.id, orderNo: o.orderNo, customer: o.customer.name, product: "Dastavka", unit: "", qty: 0, price: 0, delivery: fee,
        net: fee, vat: 0, total: fee, receiver: o.site?.contactName || o.customer.contactPerson || null,
        phone: o.site?.contactPhone || o.customer.phone || null, site: o.site?.name || o.deliveryAddress, time: o.deliveryTime,
      });
    }
  }

  const out = PAY_GROUPS.map(({ key, label }) => {
    // Bir mijozning qatorlari ketma-ket tursin (Excel'dagidek), mijozlar ichida — soat bo'yicha
    const rows = [...rowsBy[key]].sort((a, b) => a.customer.localeCompare(b.customer) || (a.time ?? "").localeCompare(b.time ?? ""));
    return { key, label, rows, totals: sumOf(rows), qtyText: qtyText(rows) };
  });
  return {
    groups: out,
    products: [...products.values()].sort((a, b) => (a.unit === "m³" ? -1 : b.unit === "m³" ? 1 : a.name.localeCompare(b.name))),
    grand: sumOf(out.flatMap((g) => g.rows)),
    orderCount: orders.length,
  };
}
