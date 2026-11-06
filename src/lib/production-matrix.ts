import { db } from "./db";
import { itemTasks } from "./production";
import { unitTotals, type UnitTotal } from "./unit";
import { STOCK_CUSTOMER_NAME } from "./stock-orders";

/**
 * Ishlab chiqarish oynasidagi «Matritsa» (zavodning Excel jadvali o'rniga): qatorlar — dona mahsulot,
 * ustunlar — ochiq zayavkalar, oxirgi ustun — natija = skladdagi qoldiq − zayavkalarda band.
 * Manfiy natija = shuncha quyish kerak.
 *
 * Qoldiq = SUM(StockMove.qty) (barcha skladlar). Band — tasdiqlangan mijoz zayavkalarining hali jo'natilmagan qismi
 * (`ostatka.ts` bilan bir xil to'plam: kind SALE, CONFIRMED / IN_PRODUCTION; qoralama band qilmaydi).
 * Reys zayavka bo'yicha yoziladi (mahsulotsiz), shuning uchun jo'natilgani qatorlarga miqdoriga mutanosib bo'linadi.
 * Sklad (zaxira) zayavkasi ham ustun bo'ladi: uning katagi — hali ishlab chiqarilmagani (jo'natish yo'q, chiqargani hovlida
 * erkin qoldiq bo'ladi). Mavjud qoldiq unga taqsimlanmaydi — zaxira zayavkasi aynan «yana shuncha ishlab chiqarish» degani.
 *
 * Bir zayavka obyektning bir nechta blokiga (A, B… binolar) bo'lingan bo'lsa — har blok alohida ustun: sarlavhada bir xil
 * mijoz va obyekt, har birida o'z bloki. Ustun kaliti `key` (zayavka id + blok id); bloksiz qatorlar — bitta ustun.
 *
 * Matritsa katagi brigada holatini ko'rsatadi: tayinlanmagan / qisman (qatorning bir qismi brigadaga berilgan) / tayinlangan;
 * katak bosilsa shu qator «Brigada tayinlash» formasida ochiladi. Doska uchun holat: tayyor — hamma qatori brigadada
 * bajarilgan; quyilmoqda — topshiriq berilgan; navbatda — hali brigadaga berilmagan. Qoldiq zayavkalarga shu tartibda, keyin yetkazish sanasi bo'yicha taqsimlanadi —
 * katak «skladdan yopiladi / qisman / yetmaydi» shundan bilinadi.
 */

export type MatrixStatus = "ready" | "pour" | "queue";
/** Brigada tayinlash holati: tayinlanmagan / qisman / to'liq */
export type MatrixAssign = "none" | "part" | "full";
/** Matritsa katagi — zayavka qatori: tayinlashda shu qator ochiladi */
export type MatrixCell = { itemId: string; qty: number; given: number; brigades: string[] };
const PRI: Record<MatrixStatus, number> = { ready: 0, pour: 1, queue: 2 };

export type MatrixProduct = { id: string; code: string; name: string; unit: string; stock: number; band: number };
export type MatrixOrder = {
  /** Ustun kaliti: zayavka id, blokli qatorlarda — `id:blokId` */
  key: string;
  /** Zayavka obyekti va ustun bloki (bloksiz ustunda null) */
  site: string | null; block: string | null;
  /** Shu ustundagi zayavka qatorlari — tayyorlik shular bo'yicha */
  itemIds: string[];
  id: string; customer: string; deliveryDate: string; dateUnknown: boolean; isUrgent: boolean; status: MatrixStatus; assign: MatrixAssign;
  /** Sklad (zaxira) zayavkasi — mijozsiz, hovliga ishlab chiqariladi */
  stock: boolean;
  /** mahsulot id → jo'natilmagan miqdor (sklad zayavkasida — hali ishlab chiqarilmagani) */
  items: Record<string, number>;
  /** mahsulot id → skladdan unga to'g'ri keladigan qism */
  alloc: Record<string, number>;
  /** mahsulot id → zayavka qatori va uning brigadalarga berilgani (qator miqdori, jo'natilganidan qat'i nazar) */
  cells: Record<string, MatrixCell>;
};
/**
 * Yuqoridagi kartalar — birlik bo'yicha (dona, m² bir songa qo'shilmaydi). Beton (m³) bu yerda umuman yo'q:
 * u ishlab chiqarishga tushmaydi — zayavka qabul qilingach to'g'ridan-to'g'ri logistikaga (reys) o'tadi.
 */
export type MatrixSummary = {
  stock: UnitTotal[]; stockKinds: number;
  band: UnitTotal[]; orders: number;
  need: UnitTotal[]; needKinds: number;
  /** Muddati o'tgan, dona qatorlari hali to'liq ishlab chiqarilmagan zayavkalar */
  late: number;
};
/** Mahsulot bo'yicha «ishlab chiqarish kerak» (band − qoldiq) — bosh sahifa ro'yxati. */
export type MatrixNeed = { id: string; code: string; name: string; unit: string; band: number; stock: number; need: number };
export type ProductionMatrix = { products: MatrixProduct[]; orders: MatrixOrder[]; summary: MatrixSummary; needList: MatrixNeed[] };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function productionMatrix(): Promise<ProductionMatrix> {
  const [products, sums, orders] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, unit: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    db.order.findMany({
      where: { kind: { in: ["SALE", "STOCK"] }, status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      select: {
        id: true, kind: true, deliveryDate: true, dateUnknown: true, isUrgent: true, customer: { select: { name: true } }, site: { select: { name: true } },
        items: { select: { id: true, productId: true, qtyM3: true, product: { select: { unit: true } }, block: { select: { id: true, name: true, sortOrder: true } }, tasks: { select: { status: true, qty: true, doneQty: true, brigade: { select: { name: true } } } } } },
        trips: { where: { status: { not: "CANCELLED" } }, select: { qtyM3: true } },
      },
      take: 300,
    }),
  ]);
  const stock = new Map(sums.map((s) => [s.productId!, Number(s._sum.qty ?? 0)]));

  const rows: MatrixOrder[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let late = 0, open = 0;
  for (const o of orders) {
    const isStock = o.kind === "STOCK";
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const shipped = o.trips.reduce((s, t) => s + Number(t.qtyM3), 0);
    const left = total > 0 ? Math.max(0, 1 - shipped / total) : 0;
    // Beton (m³) qatorlari sexga tegishli emas — faqat dona mahsulot
    const dona = o.items.filter((i) => i.product.unit !== "m3");
    if (!dona.length) continue;
    // Qatorning ochiq qismi: mijozniki — jo'natilmagani; sklad zayavkasiniki — brigadalar hali chiqarmagani
    // (bekor qilingan topshiriqda chiqarib ulgurilgani ham hovlida turibdi)
    const openQty = (i: (typeof dona)[number]) => (isStock
      ? Math.max(0, Number(i.qtyM3) - i.tasks.reduce((s, t) => s + Number(t.doneQty), 0))
      : Number(i.qtyM3) * left);
    const pending = isStock ? dona.some((i) => openQty(i) > 0.0005) : left > 0;
    if (pending) open++;
    const donaOpen = dona.some((i) => !itemTasks(i.qtyM3, i.tasks).done);
    if (!o.dateUnknown && o.deliveryDate < today && pending && donaOpen) late++;
    // Obyekt bloklari bo'yicha ustunlar: bloksiz qatorlar birinchi, keyin bloklar kiritilgan tartibda
    const parts = new Map<string, typeof dona>();
    for (const i of dona) parts.set(i.block?.id ?? "", [...(parts.get(i.block?.id ?? "") ?? []), i]);
    const groups = [...parts.values()].sort((a, b) => {
      const x = a[0]!.block, y = b[0]!.block;
      if (!x || !y) return x ? 1 : y ? -1 : 0;
      return x.sortOrder - y.sortOrder || x.name.localeCompare(y.name, "uz", { numeric: true });
    });
    for (const part of groups) {
      const items: Record<string, number> = {};
      for (const i of part) {
        const q = round3(openQty(i));
        if (q > 0) items[i.productId] = (items[i.productId] ?? 0) + q;
      }
      if (!Object.keys(items).length) continue;
      const st = part.map((i) => itemTasks(i.qtyM3, i.tasks));
      const status: MatrixStatus = st.every((x) => x.done) ? "ready" : st.some((x) => x.any) ? "pour" : "queue";
      const assign: MatrixAssign = st.every((x) => x.full) ? "full" : st.some((x) => x.given > 0) ? "part" : "none";
      // Bir ustunda bir mahsulot ikki qatorda bo'lsa — birinchisi ochiladi, miqdorlar qo'shiladi
      const cells: Record<string, MatrixCell> = {};
      part.forEach((i, n) => {
        const c = (cells[i.productId] ??= { itemId: i.id, qty: 0, given: 0, brigades: [] });
        c.qty = round3(c.qty + Number(i.qtyM3)); c.given = round3(c.given + st[n]!.given);
        for (const t of i.tasks) if (t.status !== "CANCELLED" && !c.brigades.includes(t.brigade.name)) c.brigades.push(t.brigade.name);
      });
      const block = part[0]!.block;
      rows.push({
        key: block ? `${o.id}:${block.id}` : o.id, site: isStock ? null : o.site?.name ?? null, block: block?.name ?? null, itemIds: part.map((i) => i.id),
        id: o.id, customer: isStock ? STOCK_CUSTOMER_NAME : o.customer.name, deliveryDate: o.deliveryDate.toISOString(), dateUnknown: o.dateUnknown, isUrgent: o.isUrgent, status, assign, stock: isStock, items, alloc: {}, cells,
      });
    }
  }
  rows.sort((a, b) => PRI[a.status] - PRI[b.status] || a.deliveryDate.localeCompare(b.deliveryDate));

  // Qoldiqni taqsimlash: tayyor → quyilmoqda → navbatda, ichida eski sana birinchi (rows shu tartibda)
  const left = new Map(stock);
  const band = new Map<string, number>();
  for (const o of rows) {
    for (const [pid, q] of Object.entries(o.items)) {
      const have = Math.max(0, left.get(pid) ?? 0);
      // Sklad zayavkasi qoldiqdan yopilmaydi — u qoldiqqa qo'shiladigan ish (natijada «quyish kerak» ga tushadi)
      const g = o.stock ? 0 : Math.min(q, have);
      o.alloc[pid] = round3(g);
      left.set(pid, have - g);
      band.set(pid, (band.get(pid) ?? 0) + q);
    }
  }

  const list = products
    .filter((p) => p.unit !== "m3")
    .map((p) => ({ ...p, stock: round3(stock.get(p.id) ?? 0), band: round3(band.get(p.id) ?? 0) }))
    .sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));
  const round = (t: UnitTotal[]) => t.map((x) => ({ unit: x.unit, qty: round3(x.qty) })).filter((x) => x.qty > 0.0005);
  const needRows = list.map((p) => ({ unit: p.unit, qty: Math.max(0, p.band - Math.max(0, p.stock)) }));
  const summary: MatrixSummary = {
    stock: round(unitTotals(list.map((p) => ({ unit: p.unit, qty: Math.max(0, p.stock) })))),
    stockKinds: list.filter((p) => p.stock > 0).length,
    band: round(unitTotals(list.map((p) => ({ unit: p.unit, qty: p.band })))),
    orders: open,
    need: round(unitTotals(needRows)),
    needKinds: needRows.filter((x) => x.qty > 0.0005).length,
    late,
  };
  const needList: MatrixNeed[] = list
    .map((p) => ({ ...p, need: round3(Math.max(0, p.band - Math.max(0, p.stock))) }))
    .filter((x) => x.need > 0.0005).sort((a, b) => b.need - a.need);
  return { products: list, orders: rows, summary, needList };
}
