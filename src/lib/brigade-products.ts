import { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { lockStock, STOCK_EPS } from "./stock-lock";
import { brigadeLabel } from "./issue-target";

/**
 * Brigada ombori — tayyor DONA mahsulot (ustun, plita, FBS blok…) qaysi brigada javobgarligida turgani.
 *
 * Alohida jurnal yo'q: har bir mahsulot harakati (`StockMove`) `ownerBrigadeId` belgisini oladi, bo'sh — «Umumiy hovli».
 * Sklad qoldig'i avvalgidek barcha harakatlar yig'indisi (hisobotlar o'zgarmaydi), u omborlarga bo'linadi:
 *   sklad jami = Σ brigada omborlari + umumiy hovli.
 * Kim nima yozadi:
 *  · brigada topshiriqni bajardi (PRODUCTION_OUTPUT) — o'sha brigada omboriga;
 *  · «Tayyor mahsulot qo'shish» — har qatorda tanlangan brigadaga (yoki umumiy hovliga);
 *  · reys yuklash (SHIPMENT) va brak (WRITE_OFF) — `takeFromOwners`: avval o'sha zayavka/brak brigadasi, keyin umumiy,
 *    keyin qoldig'i ko'p brigada (bir necha qatorga bo'linishi mumkin);
 *  · ko'chirish (OWNER_TRANSFER) — juft yozuv: bir ombordan −, boshqasiga +, sklad jami o'zgarmaydi.
 * Beton (m³) omborga bo'linmaydi — u hovlida turmaydi, belgisi har doim bo'sh.
 */

export const COMMON_YARD = "Umumiy hovli";
/** Formadagi «Umumiy hovli» qiymati (bo'sh satr = belgisiz) */
export const COMMON_KEY = "";

export type Owner = string | null;
export type OwnerPart = { owner: Owner; qty: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Bitta skladdagi bitta mahsulot qoldig'i — ombor bo'yicha (kalit: brigada id yoki null). Qulf chaqiruvchida. */
export async function ownerBalances(tx: Prisma.TransactionClient, warehouseId: string, productId: string): Promise<Map<Owner, number>> {
  const sums = await tx.stockMove.groupBy({ by: ["ownerBrigadeId"], where: { warehouseId, productId }, _sum: { qty: true } });
  return new Map(sums.map((s) => [s.ownerBrigadeId, Number(s._sum.qty ?? 0)]));
}

/**
 * `qty` ni omborlardan olish tartibi: `prefer` (masalan zayavkani ishlagan brigadalar) → umumiy hovli → qolgan brigadalar
 * (qoldig'i ko'pidan). Faqat musbat qoldiqdan olinadi. Yetmasa (sklad jami boshqa joyda tekshirilgan, bu kamdan-kam) —
 * qolgan qism birinchi tanlangan omborga yoziladi (o'sha ombor minusga ketadi, ko'chirish bilan tuzatiladi).
 */
export function splitByOwners(bal: Map<Owner, number>, qty: number, prefer: Owner[] = []): OwnerPart[] {
  const order: Owner[] = [];
  const push = (o: Owner) => { if (!order.includes(o)) order.push(o); };
  for (const o of prefer) push(o);
  push(null);
  [...bal.entries()].filter(([o]) => o !== null).sort((a, b) => b[1] - a[1]).forEach(([o]) => push(o));
  const parts: OwnerPart[] = [];
  let left = qty;
  for (const o of order) {
    if (left <= STOCK_EPS) break;
    const have = bal.get(o) ?? 0;
    if (have <= STOCK_EPS) continue;
    const take = r3(Math.min(left, have));
    parts.push({ owner: o, qty: take });
    left = r3(left - take);
  }
  if (left > STOCK_EPS) {
    const first = prefer[0] !== undefined ? prefer[0] : (parts[0]?.owner ?? null);
    const same = parts.find((p) => p.owner === first);
    if (same) same.qty = r3(same.qty + left);
    else parts.push({ owner: first, qty: left });
  }
  return parts;
}

/** Skladdan mahsulot chiqarish uchun omborlar bo'yicha bo'lish (qulf chaqiruvchida, `lockStock`). */
export async function takeFromOwners(tx: Prisma.TransactionClient, p: { warehouseId: string; productId: string; qty: number; prefer?: Owner[] }): Promise<OwnerPart[]> {
  const bal = await ownerBalances(tx, p.warehouseId, p.productId);
  return splitByOwners(bal, p.qty, p.prefer ?? []);
}

/** Brigadalar nomi (brigadir bilan) — ombor yorlig'i uchun; nofaol brigada ham (eski harakatlar). */
export async function brigadeNames(client: Prisma.TransactionClient | typeof db = db): Promise<Map<string, string>> {
  const list = await client.brigade.findMany({ select: { id: true, name: true, leader: { select: { fullName: true } } } });
  return new Map(list.map((b) => [b.id, brigadeLabel({ name: b.name, leader: b.leader?.fullName ?? null })]));
}

export const ownerLabel = (names: Map<string, string>, o: Owner) => (o ? names.get(o) ?? "Brigada" : COMMON_YARD);

// ───────────────────────── Ko'rinishlar ─────────────────────────

export type OwnerColumn = { key: string; owner: Owner; name: string };
export type OwnerRow = { productId: string; name: string; unit: string; total: number; byOwner: Record<string, number> };

/**
 * Sklad → «Brigada omborlari» jadvali: mahsulot × ombor. Ustunlar — qoldig'i bor brigadalar (nomi bo'yicha), oxirida umumiy hovli.
 * `productId` berilsa — faqat shu mahsulot (mahsulot sahifasi).
 */
export async function ownerOverview(opts?: { productId?: string; warehouseId?: string }): Promise<{ columns: OwnerColumn[]; rows: OwnerRow[] }> {
  const [sums, products, names] = await Promise.all([
    db.stockMove.groupBy({
      by: ["productId", "ownerBrigadeId"],
      where: { productId: opts?.productId ?? { not: null }, product: { unit: { not: "m3" } }, ...(opts?.warehouseId ? { warehouseId: opts.warehouseId } : {}) },
      _sum: { qty: true },
    }),
    db.product.findMany({ where: { unit: { not: "m3" }, ...(opts?.productId ? { id: opts.productId } : {}) }, select: { id: true, name: true, unit: true } }),
    brigadeNames(),
  ]);
  const meta = new Map(products.map((p) => [p.id, p]));
  const rows = new Map<string, OwnerRow>();
  const used = new Set<Owner>();
  for (const s of sums) {
    const q = r3(Number(s._sum.qty ?? 0));
    const p = meta.get(s.productId!);
    if (!p || Math.abs(q) <= STOCK_EPS) continue;
    const r = rows.get(p.id) ?? { productId: p.id, name: p.name, unit: p.unit, total: 0, byOwner: {} };
    const k = s.ownerBrigadeId ?? COMMON_KEY;
    r.byOwner[k] = r3((r.byOwner[k] ?? 0) + q);
    r.total = r3(r.total + q);
    rows.set(p.id, r);
    used.add(s.ownerBrigadeId);
  }
  const columns: OwnerColumn[] = [...used].filter((o): o is string => o !== null)
    .map((o) => ({ key: o, owner: o, name: names.get(o) ?? "Brigada" }))
    .sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));
  if (used.has(null)) columns.push({ key: COMMON_KEY, owner: null, name: COMMON_YARD });
  return { columns, rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true })) };
}

export type TurnCell = { in: number; out: number; close: number };
export type OwnerTurnRow = { productId: string; name: string; unit: string; byOwner: Record<string, TurnCell>; total: TurnCell };

/**
 * Sklad → «Hovli va tayyor mahsulot» Excel jadvali: mahsulot × ombor (brigadalar, oxirida umumiy hovli). Har omborda davrdagi
 * kirim (qty > 0), chiqim (qty < 0, musbat son bilan) va davr oxiridagi qoldiq (`to` gacha barcha harakatlar yig'indisi).
 * Ko'chirish (OWNER_TRANSFER) brigada ustunida kirim/chiqim bo'ladi, «Jami» kirim/chiqimiga esa qo'shilmaydi — sklad jami o'zgarmaydi.
 * `to` — eksklyuziv (`components/stock-period.tsx`).
 */
export async function ownerTurnover(period: { from: Date; to: Date }): Promise<{ columns: OwnerColumn[]; rows: OwnerTurnRow[] }> {
  const dona: Prisma.StockMoveWhereInput = { productId: { not: null }, product: { unit: { not: "m3" } } };
  const inPeriod: Prisma.StockMoveWhereInput = { ...dona, date: { gte: period.from, lt: period.to } };
  const [close, plus, minus, products, names] = await Promise.all([
    db.stockMove.groupBy({ by: ["productId", "ownerBrigadeId"], where: { ...dona, date: { lt: period.to } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["productId", "ownerBrigadeId", "type"], where: { ...inPeriod, qty: { gt: 0 } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["productId", "ownerBrigadeId", "type"], where: { ...inPeriod, qty: { lt: 0 } }, _sum: { qty: true } }),
    db.product.findMany({ where: { unit: { not: "m3" } }, select: { id: true, name: true, unit: true } }),
    brigadeNames(),
  ]);
  const meta = new Map(products.map((p) => [p.id, p]));
  const rows = new Map<string, OwnerTurnRow>();
  const used = new Set<Owner>();
  const at = (productId: string | null, owner: Owner) => {
    const p = productId ? meta.get(productId) : undefined;
    if (!p) return null;
    let r = rows.get(p.id);
    if (!r) { r = { productId: p.id, name: p.name, unit: p.unit, byOwner: {}, total: { in: 0, out: 0, close: 0 } }; rows.set(p.id, r); }
    const k = owner ?? COMMON_KEY;
    used.add(owner);
    let c = r.byOwner[k];
    if (!c) { c = { in: 0, out: 0, close: 0 }; r.byOwner[k] = c; }
    return { r, c };
  };
  for (const s of close) {
    const q = r3(Number(s._sum.qty ?? 0));
    if (Math.abs(q) <= STOCK_EPS) continue;
    const x = at(s.productId, s.ownerBrigadeId);
    if (!x) continue;
    x.c.close = r3(x.c.close + q);
    x.r.total.close = r3(x.r.total.close + q);
  }
  for (const [list, key] of [[plus, "in"], [minus, "out"]] as const) {
    for (const s of list) {
      const q = r3(Math.abs(Number(s._sum.qty ?? 0)));
      if (q <= STOCK_EPS) continue;
      const x = at(s.productId, s.ownerBrigadeId);
      if (!x) continue;
      x.c[key] = r3(x.c[key] + q);
      if (s.type !== "OWNER_TRANSFER") x.r.total[key] = r3(x.r.total[key] + q);
    }
  }
  const columns: OwnerColumn[] = [...used].filter((o): o is string => o !== null)
    .map((o) => ({ key: o, owner: o, name: names.get(o) ?? "Brigada" }))
    .sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));
  if (used.has(null)) columns.push({ key: COMMON_KEY, owner: null, name: COMMON_YARD });
  return { columns, rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true })) };
}

export type BrigadeProduct = { productId: string; name: string; unit: string; qty: number };

/** Bitta brigada omboridagi tayyor mahsulot (brigada kartasi, brigadir ilovasi). Nolga teng qatorlar chiqmaydi. */
export async function brigadeProducts(brigadeId: string): Promise<BrigadeProduct[]> {
  const sums = await db.stockMove.groupBy({ by: ["productId"], where: { ownerBrigadeId: brigadeId, productId: { not: null } }, _sum: { qty: true } });
  const ids = sums.filter((s) => Math.abs(Number(s._sum.qty ?? 0)) > STOCK_EPS).map((s) => s.productId!);
  if (!ids.length) return [];
  const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } });
  const q = new Map(sums.map((s) => [s.productId, r3(Number(s._sum.qty ?? 0))]));
  return products.map((p) => ({ productId: p.id, name: p.name, unit: p.unit, qty: q.get(p.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));
}

// ───────────────────────── Ko'chirish ─────────────────────────

class TransferError extends Error {}

/**
 * Tayyor mahsulotni bir ombordan boshqasiga ko'chirish: brigada → brigada, umumiy hovli → brigada (eski qoldiqni
 * taqsimlash) yoki brigada → umumiy hovli. Juft OWNER_TRANSFER yozuv (−/+), sklad va mahsulot jami o'zgarmaydi.
 * Manba omborda yetmasa — rad. Ruxsat (`stock` → `products`) va `revalidatePath` — chaqiruvchida.
 */
export async function transferProductOwner(
  input: { productId: string; warehouseId: string; from: Owner; to: Owner; qty: number; note?: string | null; clientToken?: string | null },
  userId: string,
): Promise<{ ok: true; text: string; dup?: boolean } | { error: string }> {
  const r = await transferProductOwnerLines({ ...input, lines: [{ productId: input.productId, qty: input.qty }] }, userId);
  return "error" in r ? r : { ok: true, text: r.text, dup: r.dup };
}

/**
 * Bir nechta mahsulotni bitta ombordan bitta omborga (Sklad → Hovli → «Brigadalarga ajratish»): hammasi bitta tranzaksiyada,
 * biror mahsulot manbada yetmasa — hech biri yozilmaydi. Bir mahsulot ikki qatorda bo'lsa — miqdori qo'shiladi.
 * Bir martalik kalit birinchi yozuvga — takror yuborilgan forma `dup`.
 */
export async function transferProductOwnerLines(
  input: { warehouseId: string; from: Owner; to: Owner; lines: { productId: string; qty: number }[]; note?: string | null; clientToken?: string | null },
  userId: string,
): Promise<{ ok: true; text: string; count: number; dup?: boolean } | { error: string }> {
  const from = input.from || null, to = input.to || null;
  if (from === to) return { error: "Qayerdan va qayerga bir xil — boshqa omborni tanlang" };
  const merged = new Map<string, number>();
  for (const l of input.lines) {
    if (!l.productId || !(l.qty > 0)) continue;
    merged.set(l.productId, r3((merged.get(l.productId) ?? 0) + l.qty));
  }
  if (!merged.size) return { error: "Kamida bitta mahsulotga miqdor kiriting" };
  if (merged.size > 200) return { error: "Bir yo'la 200 mahsulotdan ko'p bo'lmasin" };
  const [products, wh, brigades] = await Promise.all([
    db.product.findMany({ where: { id: { in: [...merged.keys()] } }, select: { id: true, name: true, unit: true } }),
    db.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true, name: true } }),
    db.brigade.findMany({ where: { id: { in: [from, to].filter((x): x is string => !!x) } }, select: { id: true, isActive: true } }),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const [id, q] of merged) {
    const p = byId.get(id);
    if (!p || p.unit === "m3") return { error: "Faqat dona mahsulot ko'chiriladi" };
    if (p.unit === "dona" && !Number.isInteger(q)) return { error: `${p.name}: miqdor butun son bo'lsin` };
  }
  if (!wh) return { error: "Sklad topilmadi" };
  // Nofaol brigadadan olib chiqish mumkin (qoldig'ini yopish uchun), unga berish — yo'q
  if (from && !brigades.some((b) => b.id === from)) return { error: "Brigada topilmadi" };
  if (to && !brigades.some((b) => b.id === to && b.isActive)) return { error: "Qabul qiluvchi brigada topilmadi yoki nofaol" };
  const raw = input.clientToken;
  const clientToken = typeof raw === "string" && /^[A-Za-z0-9-]{16,64}$/.test(raw.trim()) ? raw.trim() : null;
  const names = await brigadeNames();
  const fromName = ownerLabel(names, from), toName = ownerLabel(names, to);
  const note = input.note?.trim() || null;
  const items = [...merged.entries()].map(([id, qty]) => ({ p: byId.get(id)!, qty }));
  const text = items.length === 1
    ? `${items[0]!.p.name}: ${items[0]!.qty} ${items[0]!.p.unit} — ${fromName} → ${toName}`
    : `${items.length} xil mahsulot, jami ${r3(items.reduce((s, x) => s + x.qty, 0))} — ${fromName} → ${toName}`;
  const res = await db.$transaction(async (tx) => {
    await lockStock(tx);
    if (clientToken && (await tx.stockMove.findUnique({ where: { clientToken }, select: { id: true } }))) return "dup" as const;
    const sums = await tx.stockMove.groupBy({ by: ["productId"], where: { warehouseId: wh.id, ownerBrigadeId: from, productId: { in: [...merged.keys()] } }, _sum: { qty: true } });
    const have = new Map(sums.map((x) => [x.productId!, Number(x._sum.qty ?? 0)]));
    const short = items.filter((x) => (have.get(x.p.id) ?? 0) < x.qty - STOCK_EPS)
      .map((x) => `${x.p.name} (${r3(Math.max(0, have.get(x.p.id) ?? 0))} ${x.p.unit} bor, ${x.qty} so'ralgan)`);
    if (short.length) throw new TransferError(`${fromName}da yetmaydi: ${short.join(", ")}`);
    const label = `${fromName} → ${toName}${note ? ` · ${note}` : ""}`;
    let firstId = "";
    for (const [i, { p, qty }] of items.entries()) {
      const out = await tx.stockMove.create({
        data: { type: "OWNER_TRANSFER", warehouseId: wh.id, productId: p.id, ownerBrigadeId: from, qty: -qty, refType: "OwnerTransfer", note: label, clientToken: i === 0 ? clientToken : null, createdById: userId },
      });
      await tx.stockMove.create({
        data: { type: "OWNER_TRANSFER", warehouseId: wh.id, productId: p.id, ownerBrigadeId: to, qty, refType: "OwnerTransfer", refId: out.id, note: label, createdById: userId },
      });
      await tx.stockMove.update({ where: { id: out.id }, data: { refId: out.id } });
      if (i === 0) firstId = out.id;
    }
    await audit(tx, userId, "CREATE", "StockMove", firstId, undefined, { transfer: label, warehouse: wh.name, lines: items.map((x) => ({ product: x.p.name, qty: x.qty })) });
    return "ok" as const;
  }).catch((e: Error) => {
    if (e instanceof TransferError) return { error: e.message };
    // Ikki marta bosilgan forma: ikkinchisi bir martalik kalitga urildi — birinchisi yozilgan
    if (clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "dup" as const;
    throw e;
  });
  if (typeof res === "object") return res;
  return { ok: true, text, count: items.length, dup: res === "dup" };
}
