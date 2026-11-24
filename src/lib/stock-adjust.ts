import { db } from "./db";
import { audit } from "./audit";
import { MAX_AMOUNT } from "./action";
import { lockStock, STOCK_EPS } from "./stock-lock";
import { avgUnitCosts } from "./stock";
import { issuePrices } from "./stock-price";
import { notifyAfter, notifyRoles } from "./notify";
import { money } from "./format";
import { DIRECTOR_NOTIFY_SUM, WRITE_OFF_REASONS } from "./stock-adjust-const";
import { takeFromOwners } from "./brigade-products";
import { finishedUnitCosts } from "./bi/core";

/**
 * Sklad qoldig'ini HUJJAT bilan o'zgartirish (yangi model yo'q — StockMove turlari yetarli). Veb (`stock/adjust-actions.ts`)
 * va mobil ilova (`lib/mobile/sklad-extra.ts`) shu yerdan chaqiradi — qoida bitta:
 *
 *  · Inventarizatsiya — sanab chiqish: hisobdagi va haqiqiy qoldiq solishtiriladi, farq
 *    ADJUSTMENT (±) bo'lib yoziladi (refType "Inventory", bitta sanoq — bitta refId).
 *  · Hisobdan chiqarish (spisanie) — brak, yo'qotish, muddati o'tgan: WRITE_OFF (−),
 *    qoldiqdan oshmaydi.
 *
 * Ikkalasida sabab majburiy, har biri auditda. Qoldiqqa tegadigan tekshiruv va yozuv — `lockStock` ostida
 * (parallel zames/berish bilan bir qoldiqni ikki marta ishlatmasin). Farq summasi katta bo'lsa
 * (DIRECTOR_NOTIFY_SUM dan) — yoziladi, lekin direktorga xabar ketadi.
 * Ruxsat (stock → "adjust") va `revalidatePath` — chaqiruvchida.
 */

export type AdjustResult = { ok: true; note: string } | { error: string };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ───────────────────────── Inventarizatsiya ─────────────────────────

/** `book` — sanoq boshlangandagi (forma ochilgandagi) hisobdagi qoldiq: shundan keyin o'zgargan bo'lsa yozilmaydi. */
export type CountRow = { materialId: string; book: number; actual: number };

export async function saveInventoryCount(
  input: { warehouseId: string; reason: string; rows: unknown[] },
  userId: string,
): Promise<AdjustResult> {
  const warehouseId = String(input.warehouseId ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  if (!reason) return { error: "Farq sababini yozing (masalan: oylik sanoq, tarozi xatosi, o'g'irlik)" };
  if (!Array.isArray(input.rows)) return { error: "Jadval o'qilmadi" };
  const rows: CountRow[] = (input.rows as ({ materialId?: unknown; book?: unknown; actual?: unknown } | null)[])
    .map((x) => ({ materialId: String(x?.materialId ?? ""), book: Number(x?.book), actual: Number(x?.actual) }))
    .filter((x) => x.materialId);
  if (!rows.length) return { error: "Kamida bitta xomashyoning haqiqiy qoldig'ini kiriting" };
  const bad = rows.find((x) => !Number.isFinite(x.actual) || x.actual < 0 || x.actual > MAX_AMOUNT || !Number.isFinite(x.book));
  if (bad) return { error: "Haqiqiy qoldiq manfiy bo'lmagan raqam bo'lsin" };
  if (new Set(rows.map((x) => x.materialId)).size !== rows.length) return { error: "Bir xomashyo ikki marta sanalgan" };

  const wh = await db.warehouse.findFirst({ where: { id: warehouseId, isActive: true }, select: { id: true, name: true } });
  if (!wh) return { error: "Sklad tanlanmagan" };
  const ids = rows.map((x) => x.materialId);
  const mats = await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } });
  if (mats.length !== ids.length) return { error: "Ro'yxatdagi xomashyo topilmadi — sahifani yangilang" };
  const meta = new Map(mats.map((m) => [m.id, m]));
  const batchId = crypto.randomUUID();

  const res = await db.$transaction(async (tx) => {
    await lockStock(tx);
    const sums = await tx.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: wh.id, materialId: { in: ids } }, _sum: { qty: true } });
    const bal = new Map(sums.map((x) => [x.materialId!, Number(x._sum.qty ?? 0)]));
    // Sanoq paytida (sahifa ochilgandan keyin) qoldiq o'zgargan bo'lsa — eski hisob bilan farq yozilmasin
    const moved = rows.filter((x) => Math.abs((bal.get(x.materialId) ?? 0) - x.book) > STOCK_EPS);
    if (moved.length) {
      return { error: `Sanoq paytida qoldiq o'zgardi: ${moved.slice(0, 5).map((x) => meta.get(x.materialId)?.name).join(", ")} — sahifani yangilab, shu qatorlarni qayta kiriting` };
    }
    // Kamomad (−) — chiqim: «Дона сўм» bilan (Расход jurnalidagi «Инвентаризация (недостача)» shu narxda).
    // Ortiqcha (+) — avvalgidek o'rtacha tannarx: musbat ADJUSTMENT `avgUnitCosts` manbaiga kiradi,
    // unga Snabjeniye narxi aralashmasin
    const [costs, prices] = await Promise.all([avgUnitCosts(ids, tx), issuePrices(ids, tx)]);
    const diffs = rows
      .map((x) => ({ ...x, diff: r3(x.actual - (bal.get(x.materialId) ?? 0)) }))
      .filter((x) => Math.abs(x.diff) > STOCK_EPS);
    if (!diffs.length) return { ok: true as const, count: 0, sum: 0, plus: 0, minus: 0, lines: [] as string[], first: "" };
    let sum = 0, plus = 0, minus = 0;
    const lines: string[] = [];
    for (const x of diffs) {
      const m = meta.get(x.materialId)!;
      const cost = (x.diff < 0 ? prices : costs).get(x.materialId) ?? null;
      await tx.stockMove.create({
        data: {
          type: "ADJUSTMENT", warehouseId: wh.id, materialId: x.materialId, qty: x.diff, unitCost: cost,
          refType: "Inventory", refId: batchId, createdById: userId,
          note: `Inventarizatsiya: hisobda ${r3(x.book)}, haqiqiy ${r3(x.actual)} ${m.unit} · ${reason}`,
        },
      });
      const v = Math.abs(x.diff) * (cost ?? 0);
      sum += v;
      if (x.diff > 0) plus += v; else minus += v;
      lines.push(`${m.name}: ${x.diff > 0 ? "+" : ""}${x.diff} ${m.unit}`);
    }
    await audit(tx, userId, "CREATE", "StockMove", batchId, undefined, {
      via: "inventory", warehouse: wh.name, reason, counted: rows.length,
      diffs: diffs.map((x) => ({ materialId: x.materialId, book: x.book, actual: x.actual, diff: x.diff })), sum,
    });
    return { ok: true as const, count: diffs.length, sum, plus, minus, lines, first: diffs[0].materialId };
  });
  if ("error" in res) return { error: res.error ?? "Saqlanmadi" };
  if (!res.count) return { ok: true, note: `${rows.length} ta xomashyo sanaldi — farq yo'q` };
  if (res.sum >= DIRECTOR_NOTIFY_SUM) {
    notifyAfter(() => notifyRoles(["DIRECTOR"], {
      type: "STOCK_INVENTORY",
      title: `Inventarizatsiya farqi katta — ${wh.name}`,
      body: `${res.count} qator · ortiqcha ${money(res.plus)}, kam ${money(res.minus)} · ${reason} · ${res.lines.slice(0, 3).join("; ")}`,
      link: { key: "stock", id: res.first },
    }, { except: userId }));
  }
  return {
    ok: true,
    note: `Farq yozildi: ${res.count} qator (ortiqcha ${money(res.plus)}, kam ${money(res.minus)})${res.sum >= DIRECTOR_NOTIFY_SUM ? " — summa katta, direktorga xabar ketdi" : ""}`,
  };
}

// ───────────────────────── Tayyor mahsulot sanog'i ─────────────────────────

/** `book` — sanoq boshlangandagi hisobdagi qoldiq (shu skladda, barcha omborlar yig'indisi). */
export type ProductCountRow = { productId: string; book: number; actual: number };
/** Tayyor mahsulot sanog'i yozuvlari — xomashyo sanog'idan («Inventory») ajratiladi. */
export const PRODUCT_INVENTORY_REF = "ProductInventory";

/**
 * Tayyor DONA mahsulot sanog'i (Sarvar rejasi 2-bosqich: «plita qoldig'i tizimda 770, hisob bo'yicha 72» — oy oxiri sanog'i
 * farqni tuzatish akti bilan kiritadi). Xomashyo sanog'idagi qoida: hisobdagi va haqiqiy qoldiq solishtiriladi, farq ADJUSTMENT (±),
 * bitta sanoq — bitta akt (`refType = "ProductInventory"`, `refId`), sabab majburiy, auditda; sanoq paytida qoldiq o'zgargan
 * bo'lsa yozilmaydi. Ortiqcha (+) — umumiy hovliga; kamomad (−) — omborlardan (`takeFromOwners`: umumiy hovli → brigadalar).
 * Beton (m³) sanalmaydi. Farq summasi (tannarx bo'yicha) katta bo'lsa — direktorga xabar.
 */
export async function saveProductCount(
  input: { warehouseId: string; reason: string; rows: unknown[] },
  userId: string,
): Promise<AdjustResult> {
  const warehouseId = String(input.warehouseId ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  if (!reason) return { error: "Farq sababini yozing (masalan: oy oxiri sanog'i, hisobga olinmagan sotuv)" };
  if (!Array.isArray(input.rows)) return { error: "Jadval o'qilmadi" };
  const rows: ProductCountRow[] = (input.rows as ({ productId?: unknown; book?: unknown; actual?: unknown } | null)[])
    .map((x) => ({ productId: String(x?.productId ?? ""), book: Number(x?.book), actual: Number(x?.actual) }))
    .filter((x) => x.productId);
  if (!rows.length) return { error: "Kamida bitta mahsulotning haqiqiy qoldig'ini kiriting" };
  if (rows.some((x) => !Number.isFinite(x.actual) || x.actual < 0 || x.actual > MAX_AMOUNT || !Number.isFinite(x.book))) return { error: "Haqiqiy qoldiq manfiy bo'lmagan raqam bo'lsin" };
  if (new Set(rows.map((x) => x.productId)).size !== rows.length) return { error: "Bir mahsulot ikki marta sanalgan" };

  const wh = await db.warehouse.findFirst({ where: { id: warehouseId, isActive: true }, select: { id: true, name: true } });
  if (!wh) return { error: "Sklad tanlanmagan" };
  const ids = rows.map((x) => x.productId);
  const prods = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } });
  if (prods.length !== ids.length) return { error: "Ro'yxatdagi mahsulot topilmadi — sahifani yangilang" };
  if (prods.some((p) => p.unit === "m3")) return { error: "Beton (m³) sanalmaydi — u hovlida turmaydi" };
  const meta = new Map(prods.map((p) => [p.id, p]));
  const costs = await finishedUnitCosts();
  const actNo = `SA-${Date.now().toString(36).toUpperCase()}`;
  const batchId = crypto.randomUUID();

  const res = await db.$transaction(async (tx) => {
    await lockStock(tx);
    const sums = await tx.stockMove.groupBy({ by: ["productId"], where: { warehouseId: wh.id, productId: { in: ids } }, _sum: { qty: true } });
    const bal = new Map(sums.map((x) => [x.productId!, Number(x._sum.qty ?? 0)]));
    const moved = rows.filter((x) => Math.abs((bal.get(x.productId) ?? 0) - x.book) > STOCK_EPS);
    if (moved.length) {
      return { error: `Sanoq paytida qoldiq o'zgardi: ${moved.slice(0, 5).map((x) => meta.get(x.productId)?.name).join(", ")} — sahifani yangilab, shu qatorlarni qayta kiriting` };
    }
    const diffs = rows.map((x) => ({ ...x, diff: r3(x.actual - (bal.get(x.productId) ?? 0)) })).filter((x) => Math.abs(x.diff) > STOCK_EPS);
    if (!diffs.length) return { ok: true as const, count: 0, plus: 0, minus: 0, lines: [] as string[], first: "" };
    let plus = 0, minus = 0;
    const lines: string[] = [];
    for (const x of diffs) {
      const p = meta.get(x.productId)!;
      const note = `Sanoq akti ${actNo}: hisobda ${r3(x.book)}, haqiqiy ${r3(x.actual)} ${p.unit} · ${reason}`;
      const base = { type: "ADJUSTMENT" as const, warehouseId: wh.id, productId: x.productId, refType: PRODUCT_INVENTORY_REF, refId: batchId, createdById: userId, note };
      if (x.diff > 0) await tx.stockMove.create({ data: { ...base, qty: x.diff } });
      else for (const part of await takeFromOwners(tx, { warehouseId: wh.id, productId: x.productId, qty: -x.diff })) {
        await tx.stockMove.create({ data: { ...base, ownerBrigadeId: part.owner, qty: -part.qty } });
      }
      const v = Math.abs(x.diff) * (costs.get(x.productId) ?? 0);
      if (x.diff > 0) plus += v; else minus += v;
      lines.push(`${p.name}: ${x.diff > 0 ? "+" : ""}${x.diff} ${p.unit}`);
    }
    await audit(tx, userId, "CREATE", "StockMove", batchId, undefined, {
      via: "product-inventory", act: actNo, warehouse: wh.name, reason, counted: rows.length,
      diffs: diffs.map((x) => ({ productId: x.productId, book: x.book, actual: x.actual, diff: x.diff })), plus, minus,
    });
    return { ok: true as const, count: diffs.length, plus, minus, lines, first: diffs[0]!.productId };
  });
  if ("error" in res) return { error: res.error ?? "Saqlanmadi" };
  if (!res.count) return { ok: true, note: `${rows.length} ta mahsulot sanaldi — farq yo'q` };
  if (res.plus + res.minus >= DIRECTOR_NOTIFY_SUM) {
    notifyAfter(() => notifyRoles(["DIRECTOR"], {
      type: "STOCK_INVENTORY",
      title: `Tayyor mahsulot sanog'i farqi katta — ${wh.name}`,
      body: `Akt ${actNo} · ${res.count} qator · ortiqcha ${money(res.plus)}, kam ${money(res.minus)} · ${reason} · ${res.lines.slice(0, 3).join("; ")}`,
      link: { key: "stock", id: res.first },
    }, { except: userId }));
  }
  return {
    ok: true,
    note: `Sanoq akti ${actNo}: ${res.count} qator farq yozildi (ortiqcha ${money(res.plus)}, kam ${money(res.minus)} — tannarx bo'yicha)`,
  };
}

// ───────────────────────── Hisobdan chiqarish (spisanie) ─────────────────────────

export async function saveStockWriteOff(
  input: { warehouseId: string; kind: string; note: string; rows: unknown[] },
  userId: string,
): Promise<AdjustResult> {
  const warehouseId = String(input.warehouseId ?? "").trim();
  const kind = String(input.kind ?? "").trim();
  const note = String(input.note ?? "").trim();
  if (!(WRITE_OFF_REASONS as readonly string[]).includes(kind)) return { error: "Sababni tanlang" };
  if (!note) return { error: "Izoh majburiy — nima bo'ldi, kim aniqladi" };
  if (!Array.isArray(input.rows)) return { error: "Jadval o'qilmadi" };
  const rows = (input.rows as ({ materialId?: unknown; qty?: unknown } | null)[]).map((x) => ({ materialId: String(x?.materialId ?? ""), qty: Number(x?.qty) })).filter((x) => x.materialId && x.qty !== 0);
  if (!rows.length) return { error: "Kamida bitta xomashyo va miqdor kiriting" };
  if (rows.some((x) => !Number.isFinite(x.qty) || x.qty <= 0 || x.qty > MAX_AMOUNT)) return { error: "Miqdor 0 dan katta raqam bo'lsin" };
  const wanted = new Map<string, number>();
  for (const x of rows) wanted.set(x.materialId, (wanted.get(x.materialId) ?? 0) + x.qty);

  const wh = await db.warehouse.findFirst({ where: { id: warehouseId, isActive: true }, select: { id: true, name: true } });
  if (!wh) return { error: "Sklad tanlanmagan" };
  const ids = [...wanted.keys()];
  const mats = await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } });
  if (mats.length !== ids.length) return { error: "Xomashyo topilmadi — sahifani yangilang" };
  const meta = new Map(mats.map((m) => [m.id, m]));
  const batchId = crypto.randomUUID();
  const reason = `${kind} · ${note}`;

  const res = await db.$transaction(async (tx) => {
    // Qoldiq qulf ostida va AYNAN shu sklad bo'yicha: hisobdan chiqarish qoldiqdan oshmasin
    await lockStock(tx);
    const sums = await tx.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: wh.id, materialId: { in: ids } }, _sum: { qty: true } });
    const bal = new Map(sums.map((x) => [x.materialId!, Number(x._sum.qty ?? 0)]));
    const short = [...wanted.entries()].filter(([id, q]) => (bal.get(id) ?? 0) < q - STOCK_EPS)
      .map(([id, q]) => `${meta.get(id)!.name} (${wh.name}da ${r3(bal.get(id) ?? 0)}, chiqarilmoqda ${r3(q)} ${meta.get(id)!.unit})`);
    if (short.length) return { error: `Qoldiqdan ko'p chiqarib bo'lmaydi: ${short.join(", ")}` };
    // Narx — «Дона сўм» snapshot (Snabjeniye belgilagan; bo'lmasa o'rtacha tannarx)
    const costs = await issuePrices(ids, tx);
    let sum = 0;
    for (const [id, q] of wanted) {
      const cost = costs.get(id) ?? null;
      await tx.stockMove.create({
        data: {
          type: "WRITE_OFF", warehouseId: wh.id, materialId: id, qty: -r3(q), unitCost: cost,
          refType: "WriteOff", refId: batchId, note: `Hisobdan chiqarildi: ${reason}`, createdById: userId,
        },
      });
      sum += q * (cost ?? 0);
    }
    await audit(tx, userId, "CREATE", "StockMove", batchId, undefined, {
      via: "write-off", warehouse: wh.name, reason, rows: [...wanted.entries()].map(([materialId, qty]) => ({ materialId, qty })), sum,
    });
    return { ok: true as const, sum };
  });
  if ("error" in res) return { error: res.error ?? "Saqlanmadi" };
  const lines = [...wanted.entries()].map(([id, q]) => `${meta.get(id)!.name}: ${r3(q)} ${meta.get(id)!.unit}`);
  if (res.sum >= DIRECTOR_NOTIFY_SUM) {
    notifyAfter(() => notifyRoles(["DIRECTOR"], {
      type: "STOCK_WRITE_OFF",
      title: `Katta hisobdan chiqarish — ${money(res.sum)}`,
      body: `${wh.name} · ${reason} · ${lines.slice(0, 3).join("; ")}`,
      link: { key: "stock", id: ids[0] },
    }, { except: userId }));
  }
  return { ok: true, note: `Hisobdan chiqarildi: ${lines.length} ta xomashyo, ${money(res.sum)}${res.sum >= DIRECTOR_NOTIFY_SUM ? " — summa katta, direktorga xabar ketdi" : ""}` };
}
