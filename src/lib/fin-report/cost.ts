import { db } from "@/lib/db";
import { loadRevenue } from "@/lib/bi/core";
import { avgUnitCosts } from "@/lib/stock";
import { companyVatPayer, lineBase, lineTotal, lineVat } from "@/lib/receipt-vat";
import { FLOW_ONLY } from "@/lib/cash-tx";
import { loadCategories, makeResolver } from "./categories";
import { type MonthKey, addMonths, monthEnd, monthKeyOf, monthStart } from "./period";
import { r2 } from "./rows";
import { sheetLine } from "./sheet-lines";

/**
 * Tannarx hisobi va mahsulot foydasi («Insof 2026» → «Tannarx hisobi», «Har bir mahsulotdan qancha foyda qolyapti»).
 *
 *  1. Kelgan xom-ashyo — oy davomida ta'minotchilardan HAQIQATDA kelgan (kirim hujjatlari) + kassadan hujjatsiz olingani,
 *     QQSsiz (korxona QQS to'lovchisi bo'lmasa — QQS bilan). Ehtiyot qism, yoqilg'i kabi xom-ashyo emas narsalar kirmaydi.
 *  2. Norma bo'yicha kerak edi — sotilgan mahsulot × retsept × oyning o'rtacha xarid narxi; guruh koeffitsiyenti =
 *     kelgan ÷ norma (Sement, Sheben…). Tannarxga kirgan = kelgan − tayyor mahsulot omborida ko'paygani ± xom-ashyo
 *     skladi qoldig'i o'zgarishi; umumiy koeffitsiyent = tannarxga kirgan ÷ norma.
 *  3. Ishlab chiqarish xarajatlari — «Tannarxga kiradi» belgilangan kassa kategoriyalari (`CashCategory.inCost`);
 *     stavka = ular ÷ tannarxga kirgan xom-ashyo. Transport, ma'muriy, bank, soliq, kredit — davr xarajati, kirmaydi.
 *  4. 1 birlik tannarx = norma bo'yicha xom-ashyo × guruh koeffitsiyenti + shu × stavka + brigada ish haqi
 *     (mahsulotning `pieceRate`, bo'lmasa papkasiniki).
 * Joriy oyda kelish notekis — mahsulot foydasi o'tgan oy koeffitsiyentlari bilan hisoblanadi (`CostMonth` bilan o'zgartirsa bo'ladi).
 */

export const COST_GROUPS = ["Sement", "Sheben, klinets, qum", "Armatura, metall", "Xim. dobavka", "Gaz (bug'lash)", "Boshqa"] as const;
export type CostGroup = (typeof COST_GROUPS)[number];
/** Koeffitsiyent hisoblanadigan guruhlar — normada bor (gaz va boshqalar retseptda yo'q). */
export const COEF_GROUPS: CostGroup[] = ["Sement", "Sheben, klinets, qum", "Armatura, metall", "Xim. dobavka"];

const RULES: [CostGroup, RegExp][] = [
  ["Sement", /sement|цемент|cement/i],
  ["Sheben, klinets, qum", /sheben|щеб|klinets|клинц|qum|песок|pesok|shag.?al|graviy|гравий|otsev|отсев|inert/i],
  ["Armatura, metall", /armatur|арматур|metal|металл|provolok|проволок|katank|катанк/i],
  ["Xim. dobavka", /dobavk|добав|xim|хим|plastif|пластиф/i],
  ["Gaz (bug'lash)", /(^|\s)gaz(\s|$)|(^|\s)газ(\s|$)|propan|metan/i],
];
const classify = (...names: (string | null | undefined)[]): CostGroup | null => {
  for (const n of names) if (n) for (const [g, re] of RULES) if (re.test(n)) return g;
  return null;
};

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const DEPTH = 4;

type RecipeLine = { materialId: string | null; productId: string | null; qty: number };
type MaterialInfo = { id: string; name: string; unit: string; group: CostGroup };

/** Xom-ashyo deb hisoblanadigan materiallar: kalit so'z bo'yicha guruhi topilgan yoki faol retseptda bor. */
async function rawMaterials(recipes: Map<string, RecipeLine[]>) {
  const [mats, groups] = await Promise.all([
    db.material.findMany({ select: { id: true, name: true, unit: true, groupId: true } }),
    db.materialGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const gById = new Map(groups.map((g) => [g.id, g]));
  const chain = (id: string | null) => {
    const out: string[] = [];
    for (let g = id ? gById.get(id) : undefined, i = 0; g && i < 10; g = g.parentId ? gById.get(g.parentId) : undefined, i++) out.push(g.name);
    return out;
  };
  const inRecipe = new Set([...recipes.values()].flat().map((l) => l.materialId).filter((x): x is string => !!x));
  const out = new Map<string, MaterialInfo>();
  for (const m of mats) {
    const g = classify(...chain(m.groupId), m.name) ?? (inRecipe.has(m.id) ? "Boshqa" : null);
    if (g) out.set(m.id, { id: m.id, name: m.name, unit: m.unit, group: g });
  }
  return out;
}

/** Faol retseptlar: mahsulot → qatorlar (1 birlik uchun). */
async function activeRecipes(): Promise<Map<string, RecipeLine[]>> {
  const rs = await db.recipe.findMany({ where: { isActive: true }, orderBy: { version: "desc" }, select: { productId: true, items: { select: { materialId: true, productId: true, qtyPerM3: true } } } });
  const out = new Map<string, RecipeLine[]>();
  for (const r of rs) if (!out.has(r.productId)) out.set(r.productId, r.items.map((i) => ({ materialId: i.materialId, productId: i.productId, qty: Number(i.qtyPerM3) })));
  return out;
}

/** Mahsulot 1 birligi uchun xom-ashyo sarfi (material → miqdor); ichidagi mahsulot (FBS → beton) o'z retseptiga yoyiladi. */
function expand(productId: string, recipes: Map<string, RecipeLine[]>, k = 1, depth = 0, acc = new Map<string, number>()): Map<string, number> | null {
  const lines = recipes.get(productId);
  if (!lines?.length || depth > DEPTH) return null;
  for (const l of lines) {
    if (l.materialId) acc.set(l.materialId, (acc.get(l.materialId) ?? 0) + l.qty * k);
    else if (l.productId && !expand(l.productId, recipes, k * l.qty, depth + 1, acc)) return null;
  }
  return acc;
}

/** Mahsulotning yuqori papkasi nomi (Beton, Plita, Stolba…) va brigada ish haqi (mahsulotda yoki yaqin papkada). */
export async function productInfo() {
  const [products, groups] = await Promise.all([
    db.product.findMany({ select: { id: true, name: true, code: true, unit: true, groupId: true, pieceRate: true } }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true, pieceRate: true } }),
  ]);
  const gById = new Map(groups.map((g) => [g.id, g]));
  const out = new Map<string, { id: string; name: string; code: string; unit: string; group: string; groupId: string | null; wage: number | null }>();
  for (const p of products) {
    let g = p.groupId ? gById.get(p.groupId) : undefined;
    let wage = p.pieceRate != null ? Number(p.pieceRate) : null;
    for (let i = 0; g && i < 10; i++) {
      if (wage === null && g.pieceRate != null) wage = Number(g.pieceRate);
      if (!g.parentId) break;
      g = gById.get(g.parentId) ?? g;
    }
    out.set(p.id, { id: p.id, name: p.name, code: p.code, unit: p.unit, group: g?.name ?? "Boshqalar", groupId: g?.id ?? null, wage });
  }
  return out;
}

export const isVolumeUnit = (u: string) => /^m(3|³)$|^м3$/i.test(u.trim());

// ───────────────────────── Tannarx hisobi (oy) ─────────────────────────

export type ArrivalRow = { group: CostGroup; supplier: string; supplierId: string | null; gross: number; hasVat: boolean; net: number; source: "receipt" | "cash" };
export type GroupRow = { group: CostGroup; arrived: number; norm: number; diff: number; coef: number | null };
export type OverheadRow = { name: string; amount: number };
export type ItemCost = {
  productId: string; name: string; code: string; unit: string; group: string;
  produced: number; sold: number; revenue: number;
  material: number | null; wage: number; overhead: number | null; unitCost: number | null; price: number | null; profit: number | null; margin: number | null;
};
/** Mahsulot foydasi uchun sozlamalar: `coefs`/`overheadPct` — amaldagisi, `auto…` — `source` oyining avtomatik qiymati. */
export type CostParams = {
  month: MonthKey; source: MonthKey; coefs: Record<string, number>; overheadPct: number;
  autoCoefs: Record<string, number>; autoPct: number; manual: { coefs: string[]; overheadPct: boolean };
};

export type CostSheet = {
  month: MonthKey; vatPayer: boolean;
  arrivals: ArrivalRow[]; arrivedGross: number; arrivedNet: number;
  groups: GroupRow[];
  finishedIncrease: number; rawStockChange: number; consumed: number; normTotal: number; normDiff: number; coefTotal: number | null;
  overhead: OverheadRow[]; overheadTotal: number; overheadPct: number;
  /** Shu oy uchun avtomatik koeffitsiyentlar (o'zgartirishsiz) */
  autoCoefs: Record<string, number>;
  items: ItemCost[];
};

type Ctx = { recipes: Map<string, RecipeLine[]>; mats: Map<string, MaterialInfo>; products: Awaited<ReturnType<typeof productInfo>>; avgAll: Map<string, number> };

async function context(): Promise<Ctx> {
  const recipes = await activeRecipes();
  const [mats, products, avgAll] = await Promise.all([rawMaterials(recipes), productInfo(), avgUnitCosts()]);
  return { recipes, mats, products, avgAll };
}

/** Oyning o'rtacha xarid narxi (kirimdan, QQSsiz + dostavka); shu oyda kirim bo'lmasa — umumiy o'rtacha. */
async function monthPrices(from: Date, to: Date, vatPayer: boolean, avgAll: Map<string, number>) {
  const items = await db.goodsReceiptItem.findMany({ where: { receipt: { cancelledAt: null, date: { gte: from, lt: to } } }, select: { materialId: true, qty: true, price: true, vatAmount: true, deliveryCost: true } });
  const q = new Map<string, number>(), v = new Map<string, number>();
  for (const i of items) {
    q.set(i.materialId, (q.get(i.materialId) ?? 0) + Number(i.qty));
    v.set(i.materialId, (v.get(i.materialId) ?? 0) + (vatPayer ? lineBase(i) : lineTotal(i)));
  }
  const out = new Map(avgAll);
  for (const [id, qty] of q) if (qty > 0) out.set(id, (v.get(id) ?? 0) / qty);
  return out;
}

/** 1 birlik uchun norma bo'yicha xom-ashyo qiymati guruhlar bo'yicha; retsept yoki narx yo'q — null. */
function normByGroup(productId: string, ctx: Ctx, price: Map<string, number>): Map<CostGroup, number> | null {
  const use = expand(productId, ctx.recipes);
  if (!use) return null;
  const out = new Map<CostGroup, number>();
  for (const [mid, qty] of use) {
    const p = price.get(mid);
    if (p === undefined) return null;
    const g = ctx.mats.get(mid)?.group ?? "Boshqa";
    out.set(g, (out.get(g) ?? 0) + qty * p);
  }
  return out;
}

const materialCost = (norm: Map<CostGroup, number>, coefs: Record<string, number>) => sum([...norm.entries()].map(([g, v]) => v * (coefs[g] ?? 1)));

export async function costSheet(month: MonthKey, params?: CostParams, ctxIn?: Ctx): Promise<CostSheet> {
  const from = monthStart(month), to = monthEnd(month);
  const ctx = ctxIn ?? (await context());
  const vatPayer = await companyVatPayer();
  const [price, receipts, cashTx, nodes, revenue, finMoves, rawOpen, rawClose, produced] = await Promise.all([
    monthPrices(from, to, vatPayer, ctx.avgAll),
    db.goodsReceipt.findMany({ where: { cancelledAt: null, date: { gte: from, lt: to } }, select: { supplierId: true, supplier: { select: { name: true } }, items: { select: { materialId: true, qty: true, price: true, vatAmount: true, deliveryCost: true } } } }),
    db.cashTransaction.findMany({ where: { ...FLOW_ONLY, cancelledAt: null, date: { gte: from, lt: to } }, select: { type: true, amount: true, category: true, subCategory: true, refType: true, supplierId: true } }),
    loadCategories(),
    loadRevenue(from, to),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null }, date: { gte: from, lt: to } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null }, date: { lt: from } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null }, date: { lt: to } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: from, lt: to } }, _sum: { qty: true } }),
  ]);
  const resolve = makeResolver(nodes);

  // ── 1. Kelgan xom-ashyo ──
  const arr = new Map<string, ArrivalRow>();
  for (const r of receipts) {
    for (const i of r.items) {
      const m = ctx.mats.get(i.materialId);
      if (!m) continue;
      const k = `${m.group}|${r.supplierId}`;
      let a = arr.get(k);
      if (!a) arr.set(k, (a = { group: m.group, supplier: r.supplier.name, supplierId: r.supplierId, gross: 0, hasVat: false, net: 0, source: "receipt" }));
      a.gross += lineTotal(i);
      a.net += vatPayer ? lineBase(i) : lineTotal(i);
      if (lineVat(i) > 0) a.hasVat = true;
    }
  }
  // Kassadan hujjatsiz xom-ashyo (naqd sement va h.k.) — ta'minotchi to'lovi emas
  let cashRaw = 0;
  for (const t of cashTx) {
    if (t.refType || t.supplierId) continue;
    const r = resolve(t.category, t.subCategory);
    if (r?.top.pnlLine !== "MATERIALS") continue;
    cashRaw += (t.type === "EXPENSE" ? 1 : -1) * Number(t.amount);
  }
  if (Math.abs(cashRaw) >= 1) arr.set("cash", { group: "Boshqa", supplier: "Kassadan (kirim hujjatisiz)", supplierId: null, gross: cashRaw, hasVat: false, net: cashRaw, source: "cash" });
  const arrivals = [...arr.values()].map((a) => ({ ...a, gross: r2(a.gross), net: r2(a.net) }))
    .sort((a, b) => COST_GROUPS.indexOf(a.group) - COST_GROUPS.indexOf(b.group) || b.net - a.net);

  // ── 2. Norma (sotilganga) va guruh koeffitsiyentlari ──
  const sold = new Map<string, { qty: number; net: number }>();
  for (const r of revenue) { const x = sold.get(r.productId) ?? { qty: 0, net: 0 }; x.qty += r.qty; x.net += r.net; sold.set(r.productId, x); }
  const normCache = new Map<string, Map<CostGroup, number> | null>();
  const normOf = (id: string) => { if (!normCache.has(id)) normCache.set(id, normByGroup(id, ctx, price)); return normCache.get(id)!; };
  const normG = new Map<CostGroup, number>();
  for (const [id, s] of sold) { const n = normOf(id); if (n) for (const [g, v] of n) normG.set(g, (normG.get(g) ?? 0) + v * s.qty); }
  const arrivedG = new Map<CostGroup, number>();
  for (const a of arrivals) arrivedG.set(a.group, (arrivedG.get(a.group) ?? 0) + a.net);
  const autoCoefs: Record<string, number> = {};
  const groups: GroupRow[] = COST_GROUPS.filter((g) => (arrivedG.get(g) ?? 0) !== 0 || (normG.get(g) ?? 0) !== 0).map((g) => {
    const arrived = r2(arrivedG.get(g) ?? 0), norm = r2(normG.get(g) ?? 0);
    const coef = COEF_GROUPS.includes(g) && norm > 0 ? Math.round((arrived / norm) * 1000) / 1000 : null;
    if (coef !== null) autoCoefs[g] = coef;
    return { group: g, arrived, norm, diff: r2(arrived - norm), coef };
  });
  const arrivedGross = r2(sum(arrivals.map((a) => a.gross))), arrivedNet = r2(sum(arrivals.map((a) => a.net)));

  // Tayyor mahsulot omborida ko'paygani (materiali, norma bo'yicha) va xom-ashyo skladi qoldig'i o'zgarishi
  let finishedIncrease = 0;
  for (const f of finMoves) { const q = Number(f._sum.qty ?? 0); const n = f.productId ? normOf(f.productId) : null; if (n && q) finishedIncrease += q * sum([...n.values()]); }
  const stockVal = (rows: typeof rawOpen) => sum(rows.map((r) => (r.materialId && ctx.mats.has(r.materialId) ? Math.max(0, Number(r._sum.qty ?? 0)) * (price.get(r.materialId) ?? 0) : 0)));
  const rawStockChange = r2(stockVal(rawOpen) - stockVal(rawClose));
  finishedIncrease = r2(finishedIncrease);
  const consumed = r2(arrivedNet - finishedIncrease + rawStockChange);
  const normTotal = r2(sum([...normG.values()]));

  // ── 3. Ishlab chiqarish xarajatlari ──
  const oh = new Map<string, number>();
  for (const t of cashTx) {
    const r = resolve(t.category, t.subCategory);
    if (!r || r.top.type !== "EXPENSE") continue;
    const viaSub = !!r.sub?.inCost;
    if (!viaSub && !r.top.inCost) continue;
    const name = viaSub ? r.sub!.name : sheetLine(r.top.name);
    oh.set(name, (oh.get(name) ?? 0) + (t.type === "EXPENSE" ? 1 : -1) * Number(t.amount));
  }
  const overhead = [...oh.entries()].map(([name, amount]) => ({ name, amount: r2(amount) })).filter((o) => Math.abs(o.amount) >= 1).sort((a, b) => b.amount - a.amount);
  const overheadTotal = r2(sum(overhead.map((o) => o.amount)));
  const autoPct = consumed > 0 ? Math.round((overheadTotal / consumed) * 1000) / 10 : 0;

  // ── 4. Buyum va beton tannarxi ──
  const p = params ?? { month, source: month, coefs: autoCoefs, overheadPct: autoPct, autoCoefs, autoPct, manual: { coefs: [], overheadPct: false } };
  const prodQty = new Map(produced.map((x) => [x.productId!, Number(x._sum.qty ?? 0)]));
  const ids = new Set([...sold.keys(), ...prodQty.keys()]);
  const items: ItemCost[] = [];
  for (const id of ids) {
    const info = ctx.products.get(id);
    if (!info) continue;
    const s = sold.get(id) ?? { qty: 0, net: 0 };
    const n = normOf(id);
    const material = n ? r2(materialCost(n, p.coefs)) : null;
    const wage = isVolumeUnit(info.unit) && info.wage === null ? 0 : (info.wage ?? 0);
    const overheadU = material !== null ? r2((material * p.overheadPct) / 100) : null;
    const unitCost = material !== null ? r2(material + wage + overheadU!) : null;
    const priceU = s.qty > 0 ? r2(s.net / s.qty) : null;
    const profit = unitCost !== null && priceU !== null ? r2(priceU - unitCost) : null;
    items.push({
      productId: id, name: info.name, code: info.code, unit: info.unit, group: info.group,
      produced: prodQty.get(id) ?? 0, sold: s.qty, revenue: r2(s.net),
      material, wage, overhead: overheadU, unitCost, price: priceU, profit, margin: profit !== null && priceU ? Math.round((profit / priceU) * 1000) / 10 : null,
    });
  }
  items.sort((a, b) => a.group.localeCompare(b.group, "uz") || a.name.localeCompare(b.name, "uz"));

  return {
    month, vatPayer, arrivals, arrivedGross, arrivedNet, groups,
    finishedIncrease, rawStockChange, consumed, normTotal, normDiff: r2(consumed - normTotal), coefTotal: normTotal > 0 ? Math.round((consumed / normTotal) * 1000) / 1000 : null,
    overhead, overheadTotal, overheadPct: p.overheadPct, autoCoefs, items,
  };
}

/**
 * Oy uchun tannarx sozlamalari: qo'lda o'zgartirilgani (`CostMonth`) ustun; qolgani avtomatik —
 * o'tgan oylar o'zinikidan, joriy oy (hali yopilmagan) o'tgan oynikidan.
 */
export async function costParams(month: MonthKey, ctx?: Ctx): Promise<CostParams> {
  const source = month >= monthKeyOf(new Date()) ? addMonths(month, -1) : month;
  const [auto, saved] = await Promise.all([costSheet(source, undefined, ctx), db.costMonth.findUnique({ where: { id: month } })]);
  const manual = (saved?.coefs ?? {}) as Record<string, number>;
  const coefs: Record<string, number> = { ...auto.autoCoefs };
  for (const [g, v] of Object.entries(manual)) if (typeof v === "number" && v > 0) coefs[g] = v;
  return {
    month, source, coefs,
    overheadPct: saved?.overheadPct != null ? Number(saved.overheadPct) : auto.overheadPct,
    autoCoefs: auto.autoCoefs, autoPct: auto.overheadPct,
    manual: { coefs: Object.keys(manual).filter((g) => typeof manual[g] === "number"), overheadPct: saved?.overheadPct != null },
  };
}

// ───────────────────────── Mahsulot foydasi (oy) ─────────────────────────

export type GroupProfit = { group: string; revenue: number; cost: number; profit: number; margin: number | null };
export type ProductProfit = {
  month: MonthKey; params: CostParams; items: ItemCost[]; groups: GroupProfit[];
  revenue: number; cost: number; profit: number; margin: number | null; uncostedRevenue: number; delivery: number;
  wageGroups: { id: string; name: string; pieceRate: number | null }[];
};

export async function productProfit(month: MonthKey): Promise<ProductProfit> {
  const ctx = await context();
  const params = await costParams(month, ctx);
  const from = monthStart(month), to = monthEnd(month);
  const [sheet, revenue, wageGroups] = await Promise.all([
    costSheet(month, params, ctx),
    loadRevenue(from, to),
    db.productGroup.findMany({ where: { parentId: null, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, pieceRate: true } }),
  ]);
  const items = sheet.items.filter((i) => i.sold > 0).sort((a, b) => (b.profit ?? -Infinity) * b.sold - (a.profit ?? -Infinity) * a.sold);
  const g = new Map<string, GroupProfit>();
  let uncostedRevenue = 0;
  for (const i of items) {
    if (i.unitCost === null) { uncostedRevenue += i.revenue; continue; }
    const x = g.get(i.group) ?? { group: i.group, revenue: 0, cost: 0, profit: 0, margin: null };
    x.revenue += i.revenue; x.cost += i.unitCost * i.sold;
    g.set(i.group, x);
  }
  const groups = [...g.values()].map((x) => ({ ...x, revenue: r2(x.revenue), cost: r2(x.cost), profit: r2(x.revenue - x.cost), margin: x.revenue > 0 ? Math.round(((x.revenue - x.cost) / x.revenue) * 1000) / 10 : null })).sort((a, b) => b.revenue - a.revenue);
  const rev = r2(sum(groups.map((x) => x.revenue))), cost = r2(sum(groups.map((x) => x.cost)));

  // Dostavka — zayavkadagi «Доставка» summasi, shu oyda yetkazilgan ulushi bo'yicha (tushumga kirmaydi)
  const share = new Map<string, number>();
  for (const r of revenue) share.set(r.orderId, (share.get(r.orderId) ?? 0) + r.qty);
  const orders = share.size ? await db.order.findMany({ where: { id: { in: [...share.keys()] }, deliveryFee: { gt: 0 } }, select: { id: true, deliveryFee: true, items: { select: { qtyM3: true } } } }) : [];
  const delivery = r2(sum(orders.map((o) => { const t = sum(o.items.map((i) => Number(i.qtyM3))); return t > 0 ? Number(o.deliveryFee) * Math.min(1, (share.get(o.id) ?? 0) / t) : 0; })));

  return {
    month, params, items, groups, revenue: rev, cost, profit: r2(rev - cost), margin: rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : null,
    uncostedRevenue: r2(uncostedRevenue), delivery,
    wageGroups: wageGroups.map((w) => ({ id: w.id, name: w.name, pieceRate: w.pieceRate != null ? Number(w.pieceRate) : null })),
  };
}

/** Mahsulot guruhlari (yuqori papka) bo'yicha sotuv [from, to): miqdor, tushum (QQSsiz), o'lchov — «Oylik reja» uchun. */
export async function groupSales(from: Date, to: Date): Promise<{ group: string; unit: string; qty: number; net: number; price: number }[]> {
  const [rows, info] = await Promise.all([loadRevenue(from, to), productInfo()]);
  const m = new Map<string, { group: string; units: Map<string, number>; qty: number; net: number }>();
  for (const r of rows) {
    const g = info.get(r.productId)?.group ?? "Boshqalar";
    const x = m.get(g) ?? { group: g, units: new Map(), qty: 0, net: 0 };
    x.qty += r.qty; x.net += r.net; x.units.set(r.unit, (x.units.get(r.unit) ?? 0) + r.qty);
    m.set(g, x);
  }
  return [...m.values()].map((x) => ({ group: x.group, unit: [...x.units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "", qty: r2(x.qty), net: r2(x.net), price: x.qty > 0 ? r2(x.net / x.qty) : 0 })).sort((a, b) => b.net - a.net);
}
