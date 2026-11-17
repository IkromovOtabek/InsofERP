import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { COMMON_YARD } from "./brigade-products";
import { STOCK_EPS, lockStock } from "./stock-lock";
import { audit } from "./audit";

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
  /** Tahrir formasi uchun: izoh to'liq (yuqoridagi `note` amal nomini takrorlasa bo'sh) */
  rawNote: string | null;
};
export type YardMoves = {
  product: { id: string; name: string; unit: string };
  ownerName: string;
  rows: YardMoveRow[];
  /** Davrdagi jami (oynadagi qatorlar 300 tadan ko'p bo'lsa ham to'liq summa) */
  sumIn: number; sumOut: number; count: number;
  /** Shu ombordagi hozirgi qoldiq (davrdan qat'i nazar) */
  balance: number;
  /** Yozuvni tahrirlash / o'chirish huquqi (`stock.yard_edit`, `stock.yard_delete`) — oynada tugmalar */
  can?: { edit: boolean; del: boolean };
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
      doc, storno: !!m.note && (m.note.startsWith("Storno ") || m.note.startsWith("Bekor qilish ")), rawNote: m.note,
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

// ───────────────────────── Yozuvni tahrirlash / o'chirish ─────────────────────────

/**
 * Tayyor mahsulot harakatini tuzatish (Otabek 2026-11-17: «kirim yoki chiqim — ustunlardagi qo'shilganlarni tahrirlash, o'chirish»):
 * `stock.yard_edit` — miqdor, sana, izoh; `stock.yard_delete` — yozuv bazadan o'chadi. Har yozuv (qo'lda, reys, topshiriq, brak) —
 * faqat sklad harakati o'zgaradi, hujjatning o'zi (reys, topshiriq) o'zgarmaydi. Oldingi va yangi qiymat AuditLog'da.
 *  · Yo'nalish (kirim/chiqim) saqlanadi — miqdor musbat yoziladi.
 *  · Brigadalar orasidagi ko'chirish juft yozuv: biri o'zgarsa ikkinchisi ham (qarama-qarshi ishora bilan), o'chirilsa — ikkalasi.
 *  · Ombor qoldig'i manfiyga tushadigan o'zgarish rad etiladi (`lockStock` ostida tekshiriladi).
 */
export type YardEdit = { qty: number; date: string; note: string };
type EditResult = { ok: true } | { error: string };

const moveSel = { id: true, type: true, qty: true, date: true, note: true, refId: true, refType: true, productId: true, warehouseId: true, ownerBrigadeId: true } as const;

async function withPair(tx: Prisma.TransactionClient, id: string) {
  const m = await tx.stockMove.findUnique({ where: { id }, select: moveSel });
  if (!m || !m.productId) return null;
  const pair = m.type === "OWNER_TRANSFER"
    ? await tx.stockMove.findFirst({ where: { type: "OWNER_TRANSFER", id: { not: m.id }, OR: [{ refId: m.id }, ...(m.refId ? [{ id: m.refId }] : [])] }, select: moveSel })
    : null;
  return { m, pair };
}

/** Ombor (sklad + mahsulot + brigada) qoldig'i shu o'zgarishdan keyin manfiy bo'lmasin; `delta` — qoldiqqa qo'shiladigan farq */
async function checkBalance(tx: Prisma.TransactionClient, m: { warehouseId: string; productId: string | null; ownerBrigadeId: string | null }, delta: number): Promise<string | null> {
  if (delta >= -STOCK_EPS) return null;
  const b = await tx.stockMove.aggregate({ where: { warehouseId: m.warehouseId, productId: m.productId, ownerBrigadeId: m.ownerBrigadeId }, _sum: { qty: true } });
  const now = Number(b._sum.qty ?? 0);
  if (now + delta < -STOCK_EPS) {
    const who = m.ownerBrigadeId ? (await tx.brigade.findUnique({ where: { id: m.ownerBrigadeId }, select: { name: true } }))?.name ?? "brigada" : COMMON_YARD;
    return `${who} omborida qoldiq ${r3(now)} — bu o'zgarishdan keyin ${r3(now + delta)} bo'lib qoladi. Avval chiqimlarni tuzating`;
  }
  return null;
}

class YardError extends Error {}

export async function editYardMove(id: string, input: YardEdit, userId: string): Promise<EditResult> {
  const amount = r3(Math.abs(Number(input.qty)));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Miqdor 0 dan katta bo'lsin" };
  if (amount > 1_000_000) return { error: "Miqdor juda katta" };
  const d = day(input.date);
  if (!d) return { error: "Sanani tanlang" };
  if (d.getTime() > Date.now() + 86_400_000) return { error: "Sana kelajakda bo'lmasin" };
  const note = String(input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 300) || null;
  try {
    await db.$transaction(async (tx) => {
      await lockStock(tx);
      const got = await withPair(tx, id);
      if (!got) throw new YardError("Yozuv topilmadi — oynani yangilang");
      const { m, pair } = got;
      const old = Number(m.qty);
      const qty = old < 0 ? -amount : amount;
      // Sana kuni o'zgarsa — soat saqlanadi
      const date = new Date(d); date.setHours(m.date.getHours(), m.date.getMinutes(), m.date.getSeconds(), m.date.getMilliseconds());
      const sameDay = isoDay(m.date) === input.date;
      const err = await checkBalance(tx, m, qty - old) ?? (pair ? await checkBalance(tx, pair, -qty - Number(pair.qty)) : null);
      if (err) throw new YardError(err);
      const data = { qty, date: sameDay ? m.date : date, note };
      await tx.stockMove.update({ where: { id: m.id }, data });
      await audit(tx, userId, "UPDATE", "StockMove", m.id, { qty: m.qty, date: m.date, note: m.note }, { ...data, via: "yard-edit" });
      if (pair) {
        const pd = { qty: -qty, date: data.date };
        await tx.stockMove.update({ where: { id: pair.id }, data: pd });
        await audit(tx, userId, "UPDATE", "StockMove", pair.id, { qty: pair.qty, date: pair.date }, { ...pd, via: "yard-edit-pair" });
      }
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof YardError) return { error: e.message };
    throw e;
  }
}

export async function deleteYardMove(id: string, userId: string): Promise<EditResult> {
  try {
    await db.$transaction(async (tx) => {
      await lockStock(tx);
      const got = await withPair(tx, id);
      if (!got) throw new YardError("Yozuv topilmadi — oynani yangilang");
      for (const x of [got.m, ...(got.pair ? [got.pair] : [])]) {
        const err = await checkBalance(tx, x, -Number(x.qty));
        if (err) throw new YardError(err);
      }
      for (const x of [got.m, ...(got.pair ? [got.pair] : [])]) {
        await tx.stockMove.delete({ where: { id: x.id } });
        await audit(tx, userId, "DELETE", "StockMove", x.id, x, { via: "yard-delete" });
      }
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof YardError) return { error: e.message };
    throw e;
  }
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
