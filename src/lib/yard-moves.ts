import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { COMMON_YARD } from "./brigade-products";
import { STOCK_EPS } from "./stock-lock";

/**
 * Hovli (tayyor dona mahsulot) harakatlari — Sklad → «Hovli va tayyor mahsulot» jadvalidagi Kirim / Chiqim katagi bosilganda
 * va zayavkadagi «Brigadadan olish» ustunida ochiladigan oyna uchun: har yozuv kim tomonidan, qaysi sana va soatda,
 * qaysi hujjat bilan (reys, brigada topshirig'i, qo'lda kirim, brak, ko'chirish) yozilgani.
 *
 * `owner`: brigada id; "" — umumiy hovli; "*" — butun sklad (Jami ustuni: brigadalar orasidagi ko'chirish qo'shilmaydi).
 * `dir`: "in" — kirim (+), "out" — chiqim (−), "all" — ikkalasi.
 */
export type YardOwner = string;
export type YardDir = "in" | "out" | "all";
export type YardMoveRow = {
  id: string;
  /** Harakat sanasi (hujjat kuni) va yozilgan vaqti (kim qachon kiritdi) — ISO */
  date: string; createdAt: string;
  kind: string; qty: number; owner: string; warehouse: string;
  who: string | null; note: string | null;
  doc: { label: string; href: string | null } | null;
  /** Bekor qilish (storno) yozuvi */
  storno: boolean;
};
export type YardMoves = {
  product: { id: string; name: string; unit: string };
  ownerName: string;
  rows: YardMoveRow[];
  /** Davrdagi jami (oynadagi qatorlar 300 tadan ko'p bo'lsa ham to'liq summa) */
  sumIn: number; sumOut: number; count: number;
  /** Shu ombordagi hozirgi qoldiq (davrdan qat'i nazar) */
  balance: number;
};

const LIMIT = 300;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? new Date(`${v}T00:00:00`) : null);

/** Klientdan kelgan so'rovni tekshirish: id'lar, yo'nalish va davr («to» — kiritilgan kun ham kiradi) */
export function parseYardQuery(q: { productId?: unknown; owner?: unknown; dir?: unknown; from?: unknown; to?: unknown } | null | undefined):
  { productId: string; owner: YardOwner; dir: YardDir; from: Date | null; to: Date | null } | null {
  if (!q || typeof q.productId !== "string" || !ID.test(q.productId)) return null;
  const owner = typeof q.owner === "string" ? q.owner : "";
  if (owner && owner !== "*" && !ID.test(owner)) return null;
  const dir: YardDir = q.dir === "in" || q.dir === "out" ? q.dir : "all";
  const from = day(q.from), toDay = day(q.to);
  const to = toDay ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1) : null;
  return { productId: q.productId, owner, dir, from, to };
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function kindOf(m: { type: string; refType: string | null; qty: number; note: string | null }): string {
  const plus = m.qty > 0;
  switch (m.type) {
    case "PRODUCTION_OUTPUT": return plus ? "Brigada ishlab chiqardi" : "Ishlab chiqarish qaytarildi";
    case "SHIPMENT": return plus ? "Reysdan qaytdi" : "Reys — mijozga jo'natildi";
    case "ADJUSTMENT":
      if (m.refType === "Manual" || m.refType === "StockIn") return m.note?.startsWith("Boshlang'ich") ? "Boshlang'ich qoldiq" : plus ? "Qo'lda qo'shildi" : "Qo'lda kamaytirildi";
      if (m.refType === "Inventory") return "Inventarizatsiya";
      return plus ? "Tuzatish (+)" : "Tuzatish (−)";
    case "WRITE_OFF": return m.refType === "ProductDefect" ? (plus ? "Brak bekor qilindi" : "Brak") : plus ? "Hisobdan chiqarish bekor qilindi" : "Hisobdan chiqarildi";
    case "OWNER_TRANSFER": return plus ? "Boshqa ombordan ko'chirildi" : "Boshqa omborga ko'chirildi";
    case "TRANSFER": return plus ? "Skladdan ko'chirildi" : "Boshqa skladga ko'chirildi";
    case "ISSUE": return plus ? "Chiqim bekor qilindi" : "Chiqim";
    case "RECEIPT": return "Kirim";
    default: return plus ? "Kirim" : "Chiqim";
  }
}

export async function yardMoves(p: { productId: string; owner: YardOwner; dir: YardDir; from?: Date | null; to?: Date | null }): Promise<YardMoves | null> {
  const product = await db.product.findUnique({ where: { id: p.productId }, select: { id: true, name: true, unit: true } });
  if (!product) return null;
  const all = p.owner === "*";
  const ownerWhere: Prisma.StockMoveWhereInput = all ? { type: { not: "OWNER_TRANSFER" } } : { ownerBrigadeId: p.owner || null };
  const where: Prisma.StockMoveWhereInput = {
    productId: product.id,
    ...ownerWhere,
    ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lt: p.to } : {}) } } : {}),
    ...(p.dir === "in" ? { qty: { gt: 0 } } : p.dir === "out" ? { qty: { lt: 0 } } : {}),
  };
  const [moves, plus, minus, bal, brigade] = await Promise.all([
    db.stockMove.findMany({
      where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: LIMIT,
      select: {
        id: true, date: true, createdAt: true, type: true, qty: true, refType: true, refId: true, note: true, ownerBrigadeId: true,
        createdBy: { select: { fullName: true } }, warehouse: { select: { name: true } }, ownerBrigade: { select: { name: true } },
      },
    }),
    db.stockMove.aggregate({ where: { ...where, qty: { gt: 0 } }, _sum: { qty: true }, _count: true }),
    db.stockMove.aggregate({ where: { ...where, qty: { lt: 0 } }, _sum: { qty: true }, _count: true }),
    db.stockMove.aggregate({ where: { productId: product.id, ...(all ? {} : { ownerBrigadeId: p.owner || null }) }, _sum: { qty: true } }),
    !all && p.owner ? db.brigade.findUnique({ where: { id: p.owner }, select: { name: true } }) : null,
  ]);

  // Hujjatlar: reys (nakladnoy, mijoz), brigada topshirig'i (zayavka), ko'chirishning qarshi tomoni
  const ids = (t: string) => [...new Set(moves.filter((m) => m.refType === t && m.refId).map((m) => m.refId!))];
  const outIds = moves.filter((m) => m.type === "OWNER_TRANSFER").map((m) => (m.refId ?? m.id));
  const [trips, tasks, pairs] = await Promise.all([
    ids("Trip").length ? db.trip.findMany({ where: { id: { in: ids("Trip") } }, select: { id: true, deliveryNoteNo: true, ttn: true, order: { select: { customer: { select: { name: true } } } } } }) : [],
    ids("BrigadeTask").length ? db.brigadeTask.findMany({ where: { id: { in: ids("BrigadeTask") } }, select: { id: true, orderId: true, order: { select: { orderNo: true, kind: true, customer: { select: { name: true } } } } } }) : [],
    outIds.length ? db.stockMove.findMany({ where: { type: "OWNER_TRANSFER", OR: [{ id: { in: outIds } }, { refId: { in: outIds } }] }, select: { id: true, refId: true, ownerBrigade: { select: { name: true } } } }) : [],
  ]);
  const tripBy = new Map(trips.map((t) => [t.id, t]));
  const taskBy = new Map(tasks.map((t) => [t.id, t]));
  // Ko'chirish juftligi: chiqim yozuvi (refId yo'q) va kirim yozuvi (refId = chiqim id)
  const pairOwner = (m: { id: string; refId: string | null }) => {
    const key = m.refId ?? m.id;
    const other = pairs.find((x) => (x.id === key || x.refId === key) && x.id !== m.id);
    return other ? other.ownerBrigade?.name ?? COMMON_YARD : null;
  };

  const rows: YardMoveRow[] = moves.map((m) => {
    const qty = r3(Number(m.qty));
    let doc: YardMoveRow["doc"] = null;
    if (m.refType === "Trip" && m.refId) {
      const t = tripBy.get(m.refId);
      doc = { label: t ? `Reys ${t.ttn || t.deliveryNoteNo} · ${t.order.customer.name}` : "Reys", href: `/trips/${m.refId}` };
    } else if (m.refType === "BrigadeTask" && m.refId) {
      const t = taskBy.get(m.refId);
      doc = t ? { label: `Topshiriq · ${t.order.kind === "STOCK" ? "sklad zayavkasi" : t.order.customer.name} (${t.order.orderNo})`, href: `/orders/${t.orderId}` } : { label: "Brigada topshirig'i", href: null };
    } else if (m.type === "OWNER_TRANSFER") {
      const o = pairOwner(m);
      doc = { label: o ? (qty > 0 ? `${o} omboridan` : `${o} omboriga`) : "Ko'chirish", href: null };
    } else if (m.refType === "ProductDefect") doc = { label: "Brak yozuvi", href: null };
    else if (m.refType === "Manual" || m.refType === "StockIn") doc = { label: "Tayyor mahsulot qo'shish", href: null };
    else if (m.refType === "Inventory") doc = { label: "Inventarizatsiya", href: "/stock/inventarizatsiya" };
    const kind = kindOf({ ...m, qty });
    return {
      id: m.id, date: m.date.toISOString(), createdAt: m.createdAt.toISOString(), kind, qty,
      owner: m.ownerBrigade?.name ?? COMMON_YARD, warehouse: m.warehouse.name, who: m.createdBy?.fullName ?? null,
      // Izoh amal nomini takrorlasa («Qo'lda qo'shildi») — ko'rsatilmaydi
      note: m.note && m.note.trim().toLowerCase() !== kind.toLowerCase() ? m.note : null,
      doc, storno: !!m.note && (m.note.startsWith("Storno ") || m.note.startsWith("Bekor qilish ")),
    };
  });
  return {
    product,
    ownerName: all ? "Butun sklad" : p.owner ? brigade?.name ?? "Brigada" : COMMON_YARD,
    rows,
    sumIn: r3(Number(plus._sum.qty ?? 0)),
    sumOut: r3(Math.abs(Number(minus._sum.qty ?? 0))),
    count: plus._count + minus._count,
    balance: (() => { const b = r3(Number(bal._sum.qty ?? 0)); return Math.abs(b) <= STOCK_EPS ? 0 : b; })(),
  };
}
