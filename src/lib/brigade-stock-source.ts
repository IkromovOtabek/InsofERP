import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { STOCK_EPS } from "./stock-lock";

/**
 * «Brigadadan olish» — zayavka qatoridagi tayyor dona mahsulot (plita, ustun, blok…) qaysi brigada omboridan beriladi
 * (`OrderItem.stockBrigadeId`). Reys yuklanganda chiqim avval shu ombordan yoziladi (`lib/trips.ts` → `writeShipment`),
 * yetmasa — avvalgi tartibda (ishlagan brigada → umumiy hovli → qoldig'i ko'p brigada).
 *
 * Erkin = brigada omboridagi qoldiq − ochiq zayavkalarda shu brigadadan olinadigan, hali jo'natilmagan qism. Jo'natilgani —
 * shu zayavka reyslari bo'yicha aynan shu brigada omboridan yozilgan SHIPMENT (qaytgani ham hisobga olinadi).
 */
export type BrigadeStockOpt = {
  brigadeId: string; name: string;
  /** Ombordagi qoldiq */ qty: number;
  /** Boshqa ochiq zayavkalar shu brigadadan olishi kerak bo'lgan (jo'natilmagan) qism */ band: number;
  /** Erkin = qoldiq − band (manfiy bo'lmaydi) */ free: number;
};
/** mahsulot id → brigadalar (erkini ko'pi tepada); faqat qoldig'i bor brigadalar */
export type BrigadeStockMap = Record<string, BrigadeStockOpt[]>;

const OPEN: Prisma.OrderWhereInput = { status: { notIn: ["DELIVERED", "CLOSED", "CANCELLED"] } };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Ochiq zayavkalarda brigadadan olinadigan, hali jo'natilmagan miqdor: kalit `brigada|mahsulot` */
async function sourceBand(client: Prisma.TransactionClient | typeof db, where: { productIds?: string[]; brigadeIds?: string[]; excludeOrderId?: string | null }): Promise<Map<string, number>> {
  const items = await client.orderItem.findMany({
    where: {
      stockBrigadeId: where.brigadeIds ? { in: where.brigadeIds } : { not: null },
      ...(where.productIds ? { productId: { in: where.productIds } } : {}),
      order: { ...OPEN, ...(where.excludeOrderId ? { id: { not: where.excludeOrderId } } : {}) },
    },
    select: { orderId: true, productId: true, stockBrigadeId: true, qtyM3: true, order: { select: { trips: { select: { id: true } } } } },
  });
  if (!items.length) return new Map();
  // Bir zayavkada bir mahsulot bir brigadadan bir nechta qatorda bo'lsa — qo'shiladi, jo'natilgani bir marta ayiriladi
  const want = new Map<string, { qty: number; trips: string[]; brigadeId: string; productId: string }>();
  for (const i of items) {
    const k = `${i.orderId}|${i.productId}|${i.stockBrigadeId}`;
    const w = want.get(k) ?? { qty: 0, trips: i.order.trips.map((t) => t.id), brigadeId: i.stockBrigadeId!, productId: i.productId };
    w.qty += Number(i.qtyM3);
    want.set(k, w);
  }
  const tripIds = [...new Set(items.flatMap((i) => i.order.trips.map((t) => t.id)))];
  const shipped = tripIds.length
    ? await client.stockMove.groupBy({
        by: ["refId", "productId", "ownerBrigadeId"],
        where: { refType: "Trip", refId: { in: tripIds }, productId: { in: [...new Set(items.map((i) => i.productId))] }, ownerBrigadeId: { in: [...new Set(items.map((i) => i.stockBrigadeId!))] } },
        _sum: { qty: true },
      })
    : [];
  const out = new Map<string, number>();
  for (const w of want.values()) {
    const trips = new Set(w.trips);
    const sent = -shipped.filter((x) => x.refId && trips.has(x.refId) && x.productId === w.productId && x.ownerBrigadeId === w.brigadeId)
      .reduce((a, x) => a + Number(x._sum.qty ?? 0), 0);
    const left = Math.max(0, w.qty - Math.max(0, sent));
    if (left > STOCK_EPS) out.set(`${w.brigadeId}|${w.productId}`, (out.get(`${w.brigadeId}|${w.productId}`) ?? 0) + left);
  }
  return out;
}

/**
 * Har mahsulot bo'yicha brigada omborlari: qoldiq, band va erkin. `excludeOrderId` — tahrirlanayotgan zayavkaning o'z bandi
 * hisobga olinmaydi (aks holda o'z qatori o'zini «band» qilib ko'rsatardi).
 */
export async function brigadeStockFor(
  productIds?: string[], excludeOrderId?: string | null,
  /** Tahrirda: zayavkada allaqachon tanlangan brigada — ombori bo'shab qolgan bo'lsa ham ro'yxatda tursin (qoldiq 0) */
  ensure: { productId: string; brigadeId: string }[] = [],
): Promise<BrigadeStockMap> {
  const [sums, band, brigades] = await Promise.all([
    db.stockMove.groupBy({
      by: ["productId", "ownerBrigadeId"],
      where: { ownerBrigadeId: { not: null }, productId: productIds ? { in: productIds } : { not: null }, product: { unit: { not: "m3" } } },
      _sum: { qty: true },
    }),
    sourceBand(db, { productIds, excludeOrderId }),
    db.brigade.findMany({ select: { id: true, name: true, isActive: true } }),
  ]);
  const meta = new Map(brigades.map((b) => [b.id, b]));
  const map: BrigadeStockMap = {};
  for (const x of sums) {
    const qty = r3(Number(x._sum.qty ?? 0));
    const b = x.ownerBrigadeId ? meta.get(x.ownerBrigadeId) : undefined;
    if (!x.productId || !b || qty <= STOCK_EPS) continue;
    const bd = r3(band.get(`${b.id}|${x.productId}`) ?? 0);
    (map[x.productId] ??= []).push({ brigadeId: b.id, name: b.name, qty, band: bd, free: r3(Math.max(0, qty - bd)) });
  }
  for (const e of ensure) {
    const b = meta.get(e.brigadeId);
    if (!b || map[e.productId]?.some((o) => o.brigadeId === b.id)) continue;
    (map[e.productId] ??= []).push({ brigadeId: b.id, name: b.name, qty: 0, band: 0, free: 0 });
  }
  for (const list of Object.values(map)) list.sort((a, b) => b.free - a.free || a.name.localeCompare(b.name, "uz", { numeric: true }));
  return map;
}

/**
 * Saqlashdan oldin: tanlangan brigadalar mavjudmi va mahsulot dona (beton emas). Miqdor erkin qoldiqdan oshsa ham saqlanadi —
 * qolgani ishlab chiqariladi / boshqa ombordan beriladi (formada ogohlantiriladi). Xato matni o'zbekcha, aks holda null.
 */
export async function checkStockSources(client: Prisma.TransactionClient | typeof db, lines: { productId: string; stockBrigadeId?: string | null }[]): Promise<string | null> {
  const ids = [...new Set(lines.map((l) => l.stockBrigadeId).filter((x): x is string => !!x))];
  if (!ids.length) return null;
  const [brigades, products] = await Promise.all([
    client.brigade.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    client.product.findMany({ where: { id: { in: [...new Set(lines.filter((l) => l.stockBrigadeId).map((l) => l.productId))] } }, select: { id: true, unit: true, name: true } }),
  ]);
  if (brigades.length !== ids.length) return "Tanlangan brigada topilmadi — sahifani yangilab qayta tanlang";
  const concrete = products.find((p) => p.unit === "m3");
  if (concrete) return `${concrete.name}: beton brigada omboridan olinmaydi — «Brigadadan olish» faqat dona mahsulot uchun`;
  return null;
}
