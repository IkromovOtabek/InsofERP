import { db } from "@/lib/db";
import { loadRevenue } from "@/lib/bi/core";
import { avgUnitCosts } from "@/lib/stock";
import { moneyShort } from "@/lib/format";
import { FLOW_ONLY } from "@/lib/cash-tx";
import type { PnlLine } from "@/generated/prisma";
import { loadCategories, makeResolver, UNKNOWN_CATEGORY } from "./categories";
import { activeAssets, depreciationIn } from "./assets";
import { type MonthKey, monthStart, monthEnd, monthKeyOf } from "./period";
import { type FinRow, row, pctRow, zeros, addInto, neg, plus } from "./rows";
import { DEPRECIATION_LINE, PNL_FIXED, sheetLine } from "./sheet-lines";

/**
 * Foyda va zarar (PNL) — oylar ustunda. Ikki rejim («Insof 2026» jadvalidagi «Foyda-Zarar» varag'idek):
 *
 *  HISOBLANGAN (accrual, asosiy):
 *   - daromad  = yetkazilgan mahsulot (`loadRevenue`, QQS'siz) mahsulot guruhlari bo'yicha + boshqa tushumlar (kassa)
 *   - tannarx  = retsept × xomashyo o'rtacha narxi; kassadagi «Xomashyo» to'lovi bu rejimda PNL'ga kirmaydi
 *     (u sklad qoldig'iga aylanadi, tannarxga sotilganda o'tadi — ikki marta hisoblanmasin)
 *   - ish haqi = shu oy uchun tasdiqlangan yakuniy vedomost (hisoblangan + ish beruvchi solig'i); vedomost
 *     bo'lmasa — kassadan to'langani. Kunbay ishchilar har doim kassadan.
 *   - amortizatsiya — asosiy vositalardan
 *   - retseptda yo'q materiallar (yoqilg'i, ehtiyot qism…) — skladdan chiqqanda «Sklad sarfi: <papka>» (`nonRecipeUse`);
 *     kirim hujjati / ta'minot zayavkasiga bog'langan kassa to'lovi bu rejimda PNL'ga kirmaydi
 *  PUL ASOSIDA (cash): daromad = mijozlar to'lovi + boshqa tushumlar; tannarx = kassadagi xom-ashyo to'lovi;
 *   xarajatlar kassadan; amortizatsiya yo'q.
 *
 * Xarajatlar kassa kategoriyasining PNL qatori (`CashCategory.pnlLine`) bo'yicha guruhlanadi. Kredit tanasi,
 * asosiy vosita xaridi, qarz berish (`NONE`) PNL'ga kirmaydi. Loyihalar — zavod foydasidan keyin, divident — oxirida.
 */
export type PnlMode = "accrual" | "cash";
export type PnlReport = { months: MonthKey[]; mode: PnlMode; rows: FinRow[]; retained: number[]; notes: string[] };

/** Kunbay ishchilar sub manbasi — vedomostga kirmaydi, hisoblangan rejimda ham kassadan olinadi («Xodimlar maoshlari» qatoriga). */
const DAY_WORKERS_SUB = "Yollanma (kunbay) ishchilar";

/** Hisoblangan rejimda PNL'ga kirmaydigan kassa to'lovlari: kirim hujjati va ta'minot zayavkasi puli (sklad qoldig'iga aylanadi). */
const STOCK_PAY_REFS = new Set(["GoodsReceipt", "SupplyRequest"]);
/** Retseptdan tashqari materiallar sarfi qatori: «Sklad sarfi: <material papkasi>». */
const STOCK_USE_PREFIX = "Sklad sarfi: ";
/** Sarf harakatlari (kirim, kirim stornosi va musbat inventarizatsiya — sarf emas). */
const USE_TYPES = ["PRODUCTION_CONSUME", "BRIGADE_ISSUE", "BRIGADE_RETURN", "ISSUE", "WRITE_OFF", "ADJUSTMENT"] as const;

/**
 * Retseptda yo'q materiallarning skladdan chiqimi (yoqilg'i, moy, ehtiyot qism, elektrod…) — hisoblangan PNL'da xarajat.
 * Retsept materiallari tannarxga retsept × o'rtacha narx bilan kiradi, bular esa haqiqiy sarf bilan. Baho — sklad aylanmasidagidek:
 * harakat narxi, bo'lmasa «Дона сўм», bo'lmasa o'rtacha kirim tannarxi. Brigadadan qaytgani sarfni kamaytiradi.
 * `twins` — retseptga ulanmagan, lekin retsept materiali bilan bir xil boshlanadigan material (dublikat: «SEMENT» ↔ «Sement M400»).
 */
async function nonRecipeUse(from: Date, to: Date) {
  const recipeItems = await db.recipeItem.findMany({ where: { recipe: { isActive: true }, materialId: { not: null } }, select: { materialId: true } });
  const recipeIds = [...new Set(recipeItems.map((r) => r.materialId!))];
  const [moves, avg, mats, groups] = await Promise.all([
    db.stockMove.findMany({
      where: { materialId: { not: null, notIn: recipeIds }, type: { in: [...USE_TYPES] }, date: { gte: from, lt: to } },
      select: { date: true, type: true, qty: true, unitCost: true, materialId: true },
    }),
    avgUnitCosts(),
    db.material.findMany({ select: { id: true, name: true, unitPrice: true, groupId: true } }),
    db.materialGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const gById = new Map(groups.map((g) => [g.id, g]));
  const topGroup = (id: string | null) => { let g = id ? gById.get(id) : undefined; for (let i = 0; g?.parentId && i < 10; i++) g = gById.get(g.parentId) ?? g; return g?.name ?? "boshqa materiallar"; };
  const mat = new Map(mats.map((m) => [m.id, m]));
  const byMat = new Map<string, number>();
  const out: { date: Date; group: string; value: number }[] = [];
  for (const mv of moves) {
    const q = Number(mv.qty);
    if (mv.type === "ADJUSTMENT" && q > 0) continue;
    const m = mat.get(mv.materialId!);
    const price = mv.unitCost != null ? Number(mv.unitCost) : m?.unitPrice != null ? Number(m.unitPrice) : avg.get(mv.materialId!) ?? 0;
    const value = Math.round(-q * price * 100) / 100;
    out.push({ date: mv.date, group: topGroup(m?.groupId ?? null), value });
    byMat.set(mv.materialId!, (byMat.get(mv.materialId!) ?? 0) + value);
  }
  const top = [...byMat.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => `${mat.get(id)?.name ?? "—"} ${moneyShort(v)}`);
  const word = (s: string) => s.toLowerCase().replace(/[^a-zа-яё'ʻ‘’ ]/gi, " ").trim().split(/\s+/)[0] ?? "";
  const recipeWords = new Map(recipeIds.map((id): [string, string] => [word(mat.get(id)?.name ?? ""), mat.get(id)?.name ?? ""]).filter(([w]) => w.length >= 4));
  const twins = [...byMat.keys()].map((id) => mat.get(id)?.name ?? "").filter((n) => recipeWords.has(word(n))).map((n) => `«${n}» ↔ «${recipeWords.get(word(n))}»`);
  return { moves: out, top, twins: [...new Set(twins)].slice(0, 5) };
}

/** Mahsulotning yuqori guruhi nomi (Plita, Stolba, Beton…); guruhsiz — «Boshqa mahsulotlar». */
async function productGroupNames(): Promise<Map<string, string>> {
  const [products, groups] = await Promise.all([
    db.product.findMany({ select: { id: true, groupId: true } }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const gById = new Map(groups.map((g) => [g.id, g]));
  const topName = (id: string | null): string => {
    let g = id ? gById.get(id) : undefined;
    for (let i = 0; g?.parentId && i < 10; i++) g = gById.get(g.parentId) ?? g;
    return g?.name ?? "Boshqa mahsulotlar";
  };
  return new Map(products.map((p) => [p.id, topName(p.groupId)]));
}

export async function pnlReport(months: MonthKey[], mode: PnlMode = "accrual"): Promise<PnlReport> {
  const n = months.length;
  const from = monthStart(months[0]!), to = monthEnd(months[n - 1]!);
  const idx = new Map(months.map((m, i) => [m, i]));
  const at = (d: Date) => idx.get(monthKeyOf(d));

  const [nodes, txs, revenue, payments, groups, payroll, assets, stockUse] = await Promise.all([
    loadCategories(),
    db.cashTransaction.findMany({
      where: { ...FLOW_ONLY, cancelledAt: null, date: { gte: from, lt: to } },
      select: { date: true, type: true, amount: true, category: true, subCategory: true, refType: true, project: { select: { name: true } } },
    }),
    mode === "accrual" ? loadRevenue(from, to) : Promise.resolve([]),
    mode === "cash" ? db.payment.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true } }) : Promise.resolve([]),
    mode === "accrual" ? productGroupNames() : Promise.resolve(new Map<string, string>()),
    mode === "accrual"
      ? db.payrollRun.findMany({ where: { month: { in: months }, kind: "FINAL", status: { in: ["APPROVED", "PAID"] } }, select: { month: true, gross: true, employerTax: true } })
      : Promise.resolve([]),
    mode === "accrual" ? activeAssets() : Promise.resolve([]),
    mode === "accrual" ? nonRecipeUse(from, to) : Promise.resolve(null),
  ]);
  const resolve = makeResolver(nodes);
  const notes: string[] = [];

  // ── Daromad ──
  const sales = new Map<string, number[]>(); // guruh → oylar (so'm)
  const qty = new Map<string, number[]>(); // guruh → oylar (dona, m³) — «Jami sotuv (dona, m3)»
  const cogs = zeros(n), uncosted = zeros(n);
  for (const r of revenue) {
    const i = at(r.date);
    if (i === undefined) continue;
    const g = groups.get(r.productId) ?? "Boshqa mahsulotlar";
    if (!sales.has(g)) { sales.set(g, zeros(n)); qty.set(g, zeros(n)); }
    addInto(sales.get(g)!, i, r.net);
    addInto(qty.get(g)!, i, r.qty);
    if (r.costKnown) addInto(cogs, i, r.cost);
    else addInto(uncosted, i, r.net);
  }
  if (mode === "cash") {
    const s = zeros(n);
    for (const p of payments) { const i = at(p.date); if (i !== undefined) addInto(s, i, Number(p.amount)); }
    sales.set("Savdo tushumi", s);
  }

  // ── Kassa: PNL qatori → manba → oylar (xarajat musbat; teskari yozuv — qaytgan pul — ayiriladi) ──
  const byLine = new Map<PnlLine | "UNKNOWN", Map<string, number[]>>();
  const put = (line: PnlLine | "UNKNOWN", name: string, i: number, v: number) => {
    let m = byLine.get(line);
    if (!m) byLine.set(line, (m = new Map()));
    if (!m.has(name)) m.set(name, zeros(n));
    addInto(m.get(name)!, i, v);
  };
  const accruedMonths = new Set(payroll.map((p) => p.month));
  for (const t of txs) {
    const i = at(t.date);
    if (i === undefined) continue;
    const a = Number(t.amount);
    const r = resolve(t.category, t.subCategory);
    if (!r) { put("UNKNOWN", UNKNOWN_CATEGORY, i, t.type === "EXPENSE" ? a : -a); continue; }
    const line = r.top.pnlLine;
    if (line === "NONE") continue;
    if (line === "MATERIALS" && mode === "accrual") continue;
    // Kirim hujjati / ta'minot zayavkasi puli — sklad qoldig'iga aylanadi, xarajat skladdan chiqqanda (tannarx yoki «Sklad sarfi»)
    if (mode === "accrual" && t.refType && STOCK_PAY_REFS.has(t.refType)) continue;
    if (line === "PAYROLL" && mode === "accrual" && accruedMonths.has(months[i]!) && r.sub?.name !== DAY_WORKERS_SUB) continue;
    // Kategoriya turiga ko'ra ishora: kirim kategoriyasida kirim (+), xarajat kategoriyasida chiqim (+)
    const v = (r.top.type === "INCOME") === (t.type === "INCOME") ? a : -a;
    // Qator nomi — jadvaldagi atama («Xodimlar maoshlari», «Zavod xarajatlari»…), loyihada — loyiha nomi
    const name = line === "PROJECT" ? (t.project?.name ?? "Loyiha tanlanmagan") : sheetLine(r.top.name, r.sub?.name);
    put(line, name, i, v);
  }
  if (mode === "accrual") {
    for (const p of payroll) {
      const i = idx.get(p.month);
      if (i !== undefined) put("PAYROLL", sheetLine("Ish haqi"), i, Number(p.gross) + Number(p.employerTax));
    }
    for (const a of assets) for (const m of months) { const v = depreciationIn(a, m); if (v) put("PRODUCTION", DEPRECIATION_LINE, idx.get(m)!, v); }
    if (stockUse) {
      for (const u of stockUse.moves) { const i = at(u.date); if (i !== undefined && u.value) put("PRODUCTION", `${STOCK_USE_PREFIX}${u.group}`, i, u.value); }
      if (stockUse.top.length) notes.push(`Retseptda yo'q materiallar (yoqilg'i, ehtiyot qism…) skladdan chiqqanda xarajat — «${STOCK_USE_PREFIX}…» qatorlari. Eng kattalari: ${stockUse.top.join(", ")}.`);
      if (stockUse.twins.length) notes.push(`Retsept materialiga o'xshash, lekin retseptga ulanmagan: ${stockUse.twins.join(", ")} — Sklad'da birlashtiring, aks holda ular tannarxga emas, «Sklad sarfi»ga tushadi.`);
    }
    if (uncosted.some((v) => v > 0)) notes.push("Ba'zi mahsulotlarning retsepti yoki xomashyo narxi yo'q — ularning tushumi tannarxsiz kirdi («Tannarxi noma'lum tushum» qatori).");
    notes.push("Daromad — yetkazilgan mahsulot, QQS'siz; dostavka summasi kirmaydi. Tannarx retsept bo'yicha (haqiqiy ÷ me'yor koeffitsiyenti keyingi bosqichda).");
  } else {
    notes.push("Pul asosida: daromad — mijozlar to'lovi (QQS bilan), tannarx — kassadan xom-ashyoga to'langan pul.");
  }

  const lineMap = (l: PnlLine | "UNKNOWN") => byLine.get(l) ?? new Map<string, number[]>();
  const lineSum = (...ls: (PnlLine | "UNKNOWN")[]) => plus(zeros(n), ...ls.flatMap((l) => [...lineMap(l).values()]));
  const sortDesc = (e: [string, number[]][]) => e.sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0));
  const subRows = (l: PnlLine, keyPrefix: string) => sortDesc([...lineMap(l).entries()]).map(([name, v]) => row(`${keyPrefix}:${name}`, name, "sub", neg(v)));
  /** Jadvaldagi qat'iy qatorlar (nol bo'lsa ham) + xaritada yo'q qo'shimchalar — bir nechta PNL qatoridan yig'iladi. */
  const fixed = new Set<string>();
  const sheetRows = (lines: PnlLine[], keyPrefix: string, order: readonly string[]) => {
    const m = new Map<string, number[]>();
    for (const l of lines) for (const [name, v] of lineMap(l)) m.set(name, plus(m.get(name) ?? zeros(n), v));
    const out = order.map((name) => row(`${keyPrefix}:${name}`, name, "sub", neg(m.get(name) ?? zeros(n))));
    for (const r of out) fixed.add(r.key);
    return [...out, ...sortDesc([...m.entries()].filter(([name]) => !order.includes(name))).map(([name, v]) => row(`${keyPrefix}:${name}`, name, "sub", neg(v)))];
  };

  const salesTotal = plus(zeros(n), ...sales.values());
  const otherIncome = lineSum("OTHER_INCOME");
  const income = plus(salesTotal, otherIncome);
  const cogsTotal = mode === "accrual" ? cogs : lineSum("MATERIALS");
  const gross = plus(income, neg(cogsTotal));
  const prodLines: PnlLine[] = ["PRODUCTION", "PAYROLL", "TRANSPORT"];
  const prod = lineSum(...prodLines), admin = lineSum("ADMIN"), comm = lineSum("COMMERCIAL"), unknown = lineSum("UNKNOWN");
  const operating = plus(gross, neg(prod), neg(admin), neg(comm), neg(unknown));
  const tax = lineSum("TAX"), interest = lineSum("INTEREST");
  const net = plus(operating, neg(tax), neg(interest));
  const projects = lineSum("PROJECT");
  const result = plus(net, neg(projects));
  const dividend = lineSum("DIVIDEND");
  const retained = plus(result, neg(dividend));

  const qtyTotal = plus(zeros(n), ...qty.values());
  const groupOrder = sortDesc([...sales.entries()]).map(([g]) => g);
  const rows: FinRow[] = [
    ...(mode === "accrual" ? [
      row("qty", "Jami sotuv (dona, m3)", "total", qtyTotal),
      ...groupOrder.map((g) => { fixed.add(`qty:${g}`); return row(`qty:${g}`, g, "sub", qty.get(g) ?? zeros(n)); }),
    ] : []),
    row("income", "Daromad", "total", income),
    ...groupOrder.map((g) => { fixed.add(`sales:${g}`); return row(`sales:${g}`, g, "sub", sales.get(g)!); }),
    row("other-income", "Boshqa tushumlar", "sub", otherIncome),
    ...(mode === "accrual" && uncosted.some((v) => v > 0) ? [row("uncosted", "shundan tannarxi noma'lum tushum", "sub", uncosted, { hint: "Retsepti yoki xomashyo narxi yo'q mahsulotlar" })] : []),
    row("cogs", mode === "accrual" ? "Sotuv tannarxi (xom-ashyo)" : "Sotuv tannarxi (xom-ashyoga to'langan)", "line", neg(cogsTotal), { hint: mode === "accrual" ? "Retsept bo'yicha xom-ashyo × o'rtacha narx (QQSsiz)" : undefined }),
    pctRow("cogs-pct", "Tannarx ulushi, %", cogsTotal, income),
    row("gross", "YALPI FOYDA", "total", gross),
    pctRow("gross-pct", "Yalpi marja, %", gross, income),
    row("prod", "Ishlab chiqarish xarajatlari", "line", neg(prod)),
    ...sheetRows(prodLines, "prod", PNL_FIXED.production),
    pctRow("prod-pct", "Ishlab chiqarish xarajatlari ulushi, %", prod, income),
    row("admin", "Ma'muriy xarajatlar", "line", neg(admin)),
    ...sheetRows(["ADMIN"], "admin", PNL_FIXED.admin),
    pctRow("admin-pct", "Ma'muriy xarajatlar ulushi, %", admin, income),
    row("comm", "Tijoriy xarajatlar", "line", neg(comm)),
    ...sheetRows(["COMMERCIAL"], "comm", PNL_FIXED.commercial),
    pctRow("comm-pct", "Tijoriy xarajatlar ulushi, %", comm, income),
    row("unknown", "Manbasi yozilmagan pul (0 bo'lishi kerak)", "check", neg(unknown), { hint: "Kategoriyasi daraxtda topilmagan kassa yozuvlari — Moliya → Kategoriyalar" }),
    row("operating", "OPERATSION FOYDA", "total", operating),
    pctRow("operating-pct", "Operatsion foyda rentabelligi, %", operating, income),
    row("tax", "Soliqlar", "line", neg(tax)),
    row("interest", "Kredit foizi (asosiy qarz to'lovi xarajat emas — balansda kreditni kamaytiradi)", "line", neg(interest)),
    row("net", "ZAVOD SOF FOYDASI", "total", net),
    pctRow("net-pct", "Sof foyda rentabelligi, %", net, income),
    row("projects", "Loyihalar (zavod foydasiga kirmaydi)", "line", neg(projects)),
    ...subRows("PROJECT", "PROJECT"),
    row("result", "JAMI NATIJA (zavod + loyihalar)", "total", result),
    row("dividend", "Divident (egasiga olingan pul)", "line", neg(dividend)),
    row("retained", "TAQSIMLANMAGAN FOYDA", "total", retained),
  ];
  // Bo'sh ichki qatorlarni chiqarmaymiz (0 summali sub), jadvaldagi qat'iy qatorlar va asosiy qatorlar doim turadi
  const visible = rows.filter((r) => r.kind !== "sub" || fixed.has(r.key) || r.values.some((v) => (v ?? 0) !== 0));
  return { months, mode, rows: visible, retained, notes };
}
