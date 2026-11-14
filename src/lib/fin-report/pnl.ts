import { cache } from "react";
import { db } from "@/lib/db";
import { loadRevenue } from "@/lib/bi/core";
import { avgUnitCosts } from "@/lib/stock";
import { fmtNum, moneyShort } from "@/lib/format";
import { PAYROLL_REF } from "@/lib/hr/payroll";
import { FLOW_ONLY, isSalesIncome } from "@/lib/cash-tx";
import { cashDayHref, finDrill, own, type Drill, type DrillItem } from "@/lib/drill";
import type { PnlLine } from "@/generated/prisma";
import { loadCategories, makeResolver, UNKNOWN_CATEGORY } from "./categories";
import { activeAssets, depreciationIn } from "./assets";
import { type MonthKey, monthStart, monthEnd, monthKeyOf, periodLabel } from "./period";
import { type FinRow, row, pctRow, zeros, addInto, neg, plus } from "./rows";
import { DEPRECIATION_LINE, PNL_FIXED, sheetLine } from "./sheet-lines";

/**
 * Foyda va zarar (PNL) — oylar ustunda. Ikki rejim («Insof 2026» jadvalidagi «Foyda-Zarar» varag'idek):
 *
 *  HISOBLANGAN (accrual, asosiy):
 *   - daromad  = yetkazilgan mahsulot (`loadRevenue`, QQS'siz) mahsulot guruhlari bo'yicha + boshqa tushumlar (kassa)
 *   - tannarx  = retsept × xomashyo o'rtacha narxi; kassadagi «Xomashyo» to'lovi bu rejimda PNL'ga kirmaydi
 *     (u sklad qoldig'iga aylanadi, tannarxga sotilganda o'tadi — ikki marta hisoblanmasin). Retsepti yo'q mahsulotga —
 *     taxminiy tannarx (`SaleRow.estCost`: shu birlikdagi retseptli sotuvning tannarx ulushi), «shundan taxminiy» qatori
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
/**
 * Hisobotning xom yig'indilari (har ustun — oy), ishorasiz: xarajat musbat. Egasi dashbordi va mobil bosh sahifa
 * foydani shu yerdan oladi — vebdagi «Foyda-zarar» bilan bitta hisob.
 */
export type PnlParts = {
  sales: number[]; otherIncome: number[]; refund: number[]; income: number[];
  cogs: number[]; cogsEst: number[]; uncosted: number[]; gross: number[];
  prod: number[]; admin: number[]; comm: number[]; unknown: number[]; operating: number[];
  tax: number[]; interest: number[]; net: number[]; projects: number[]; dividend: number[]; retained: number[];
};
export type PnlReport = { months: MonthKey[]; mode: PnlMode; rows: FinRow[]; retained: number[]; notes: string[]; parts: PnlParts };
/** Ustunlar yig'indisi (`col` berilsa — shu ustun). */
export const pnlSum = (p: PnlParts, k: keyof PnlParts, col?: number) => (col === undefined ? p[k].reduce((s, v) => s + v, 0) : p[k][col] ?? 0);

/** Kunbay ishchilar sub manbasi — vedomostga kirmaydi, hisoblangan rejimda ham kassadan olinadi («Xodimlar maoshlari» qatoriga). */
const DAY_WORKERS_SUB = "Yollanma (kunbay) ishchilar";

/** Vedomost to'lovlari qaysi oyniki (refId → PayrollRun.month) va ulardan qaysilari hisoblangan (yakuniy vedomost tasdiqlangan). */
async function payrollRunMonths(runIds: string[], months: MonthKey[]): Promise<{ month: Map<string, string>; accrued: string[] }> {
  const runs = runIds.length ? await db.payrollRun.findMany({ where: { id: { in: [...new Set(runIds)] } }, select: { id: true, month: true } }) : [];
  const all = [...new Set([...runs.map((r) => r.month), ...months])];
  const finals = await db.payrollRun.findMany({ where: { month: { in: all }, kind: "FINAL", status: { in: ["APPROVED", "PAID"] } }, select: { month: true } });
  return { month: new Map(runs.map((r) => [r.id, r.month])), accrued: finals.map((f) => f.month) };
}

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
      select: { date: true, type: true, qty: true, unitCost: true, materialId: true, material: { select: { name: true, unit: true } } },
    }),
    avgUnitCosts(),
    db.material.findMany({ select: { id: true, name: true, unitPrice: true, groupId: true } }),
    db.materialGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const gById = new Map(groups.map((g) => [g.id, g]));
  const topGroup = (id: string | null) => { let g = id ? gById.get(id) : undefined; for (let i = 0; g?.parentId && i < 10; i++) g = gById.get(g.parentId) ?? g; return g?.name ?? "boshqa materiallar"; };
  const mat = new Map(mats.map((m) => [m.id, m]));
  const byMat = new Map<string, number>();
  const out: { date: Date; group: string; value: number; name: string; qty: number; unit: string; type: string }[] = [];
  for (const mv of moves) {
    const q = Number(mv.qty);
    if (mv.type === "ADJUSTMENT" && q > 0) continue;
    const m = mat.get(mv.materialId!);
    const price = mv.unitCost != null ? Number(mv.unitCost) : m?.unitPrice != null ? Number(m.unitPrice) : avg.get(mv.materialId!) ?? 0;
    const value = Math.round(-q * price * 100) / 100;
    out.push({ date: mv.date, group: topGroup(m?.groupId ?? null), value, name: mv.material?.name ?? "—", qty: -q, unit: mv.material?.unit ?? "", type: mv.type });
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
  return pnlOnce(months.join(","), mode);
}
/** Bosh sahifada «Bugun» va boshqaruv paneli joriy oy PNL'ini ikkalasi so'raydi — bir marta (`cache`). Natija o'zgartirilmaydi. */
const pnlOnce = cache((months: string, mode: PnlMode) => buildPnl(months.split(",") as MonthKey[], mode));

/**
 * Ixtiyoriy davr PNL'i (hisoblangan) — bugun, hafta, kalendar oralig'i: o'sha qoidalar, ustunlar — davr tushgan oylar.
 * Oyning bir qismi olinsa, oy uchun hisoblanadigan summalar (ish haqi vedomosti, amortizatsiya) kunlarga bo'linadi.
 */
export async function pnlRange(from: Date, to: Date): Promise<PnlReport> {
  return rangeOnce(from.getTime(), to.getTime());
}
const rangeOnce = cache((from: number, to: number) => {
  const months: MonthKey[] = [];
  for (let d = new Date(new Date(from).getFullYear(), new Date(from).getMonth(), 1); d.getTime() < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(monthKeyOf(d));
  return buildPnl(months.length ? months : [monthKeyOf(new Date(from))], "accrual", undefined, { from: new Date(from), to: new Date(to) });
});

/** Drill-down uchun: qaysi qator kalitining yozuvlari yig'iladi (`month` — ustun, null — davr jami). */
type Trace = { match: (key: string) => boolean; month: number | null; items: DrillItem[] };

/** Kassa yozuvi tushadigan PNL qatorining kaliti — `rows` dagi kalitlar bilan bir xil (pastdagi `sheetRows`/`subRows`). */
function cashRowKey(line: PnlLine | "UNKNOWN", name: string): string {
  switch (line) {
    case "PRODUCTION": case "PAYROLL": case "TRANSPORT": return `prod:${name}`;
    case "ADMIN": return `admin:${name}`;
    case "COMMERCIAL": return `comm:${name}`;
    case "PROJECT": return `PROJECT:${name}`;
    case "OTHER_INCOME": return "other-income";
    case "CUSTOMER_REFUND": return "refund";
    case "MATERIALS": return "cogs";
    case "TAX": return "tax";
    case "INTEREST": return "interest";
    case "DIVIDEND": return "dividend";
    case "UNKNOWN": return "unknown";
    default: return line;
  }
}

/** Kassa yozuvi — drill-down ro'yxatida: kimga/kimdan (bo'lmasa manba), hisob, manba va izoh. */
type CashLike = { category: string; subCategory: string | null; counterparty: string | null; note: string | null; cashAccount: { name: string } };
const cashTitle = (t: CashLike) => t.counterparty?.trim() || t.subCategory || t.category;
const cashSub = (t: CashLike) => [t.cashAccount.name, t.subCategory ? `${t.category} → ${t.subCategory}` : t.category, t.note?.trim()].filter(Boolean).join(" · ");

const STOCK_TYPE_LABEL: Record<string, string> = {
  PRODUCTION_CONSUME: "ishlab chiqarishga sarf", BRIGADE_ISSUE: "brigadaga berildi", BRIGADE_RETURN: "brigadadan qaytdi",
  ISSUE: "chiqim", WRITE_OFF: "spisaniye", ADJUSTMENT: "inventarizatsiya",
};

async function buildPnl(months: MonthKey[], mode: PnlMode, trace?: Trace, clip?: { from: Date; to: Date }): Promise<PnlReport> {
  const n = months.length;
  const from = clip?.from ?? monthStart(months[0]!), to = clip?.to ?? monthEnd(months[n - 1]!);
  const idx = new Map(months.map((m, i) => [m, i]));
  const at = (d: Date) => (d >= from && d < to ? idx.get(monthKeyOf(d)) : undefined);
  /** Oyning davrga tushgan ulushi (kunlar bo'yicha) — oylik summalar uchun; to'liq oyda 1. */
  const shareOf = (m: MonthKey) => {
    if (!clip) return 1;
    const s = monthStart(m).getTime(), e = monthEnd(m).getTime();
    return Math.max(0, Math.min(to.getTime(), e) - Math.max(from.getTime(), s)) / (e - s);
  };

  const [nodes, txs, revenue, payments, groups, payroll, assets, stockUse] = await Promise.all([
    loadCategories(),
    db.cashTransaction.findMany({
      where: { ...FLOW_ONLY, cancelledAt: null, date: { gte: from, lt: to } },
      select: {
        date: true, type: true, amount: true, category: true, subCategory: true, refType: true, refId: true, project: { select: { name: true } },
        counterparty: true, note: true, cashAccount: { select: { name: true } },
      },
    }),
    mode === "accrual" ? loadRevenue(from, to) : Promise.resolve([]),
    mode === "cash" ? db.payment.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true, customerId: true, customer: { select: { name: true } } } }) : Promise.resolve([]),
    mode === "accrual" ? productGroupNames() : Promise.resolve(new Map<string, string>()),
    mode === "accrual"
      ? db.payrollRun.findMany({ where: { month: { in: months }, kind: "FINAL", status: { in: ["APPROVED", "PAID"] } }, select: { id: true, docNo: true, month: true, gross: true, employerTax: true } })
      : Promise.resolve([]),
    mode === "accrual" ? activeAssets() : Promise.resolve([]),
    mode === "accrual" ? nonRecipeUse(from, to) : Promise.resolve(null),
  ]);
  const resolve = makeResolver(nodes);
  const notes: string[] = [];
  /** Drill-down: so'ralgan qatorga (va ustunga) tushgan yozuvni yig'adi; oddiy hisobotda hech narsa qilmaydi. */
  const tr = (key: string, i: number, item: () => DrillItem) => {
    if (trace && (trace.month === null || trace.month === i) && trace.match(key)) trace.items.push(item());
  };

  // ── Daromad ──
  const sales = new Map<string, number[]>(); // guruh → oylar (so'm)
  const qty = new Map<string, number[]>(); // guruh → oylar (dona, m³) — «Jami sotuv (dona, m3)»
  const cogs = zeros(n), cogsEst = zeros(n), uncosted = zeros(n);
  for (const r of revenue) {
    const i = at(r.date);
    if (i === undefined) continue;
    const g = groups.get(r.productId) ?? "Boshqa mahsulotlar";
    if (!sales.has(g)) { sales.set(g, zeros(n)); qty.set(g, zeros(n)); }
    addInto(sales.get(g)!, i, r.net);
    addInto(qty.get(g)!, i, r.qty);
    if (r.costKnown) addInto(cogs, i, r.cost);
    else if (r.estCost !== undefined) { addInto(cogs, i, r.estCost); addInto(cogsEst, i, r.estCost); }
    else addInto(uncosted, i, r.net);
    if (trace) {
      const rz = r.orderId.startsWith("rz:");
      const src = { date: r.date, title: `${r.customer} — ${r.product}`, href: rz ? "/logistika/realizatsiya" : `/orders/${r.orderId}` };
      const sub = `${rz ? "Realizatsiya reestri" : `Zayavka ${r.orderNo}`} · ${fmtNum(r.qty, 3)} ${r.unit} × ${fmtNum(r.price)}`;
      tr(`sales:${g}`, i, () => ({ ...src, sub, amount: r.net }));
      tr(`qty:${g}`, i, () => ({ ...src, sub, amount: r.qty }));
      if (r.costKnown) tr("cogs", i, () => ({ ...src, sub: `${sub} · tannarx retsept bo'yicha`, amount: -r.cost }));
      else if (r.estCost !== undefined) {
        const est = { ...src, sub: `${sub} · retsept yo'q — taxminiy tannarx`, amount: -r.estCost };
        tr("cogs", i, () => est);
        tr("cogs-est", i, () => est);
      } else tr("uncosted", i, () => ({ ...src, sub: `${sub} · retsepti yoki xomashyo narxi yo'q`, amount: r.net }));
    }
  }
  if (mode === "cash") {
    // Savdo tushumi (kassa usuli) = mijoz to'lovlari + kassaga «Savdo» kirimi — DDS bilan bir xil. «Savdo» manbasi
    // PNL qatori NONE, pastdagi kassa siklida o'tkazib yuboriladi — ikki marta kirmaydi.
    const s = zeros(n);
    for (const p of payments) {
      const i = at(p.date);
      if (i === undefined) continue;
      addInto(s, i, Number(p.amount));
      tr("sales:Savdo tushumi", i, () => ({ date: p.date, title: p.customer.name, sub: "Mijoz to'lovi", amount: Number(p.amount), href: `/customers/${p.customerId}` }));
    }
    for (const t of txs.filter(isSalesIncome)) {
      const i = at(t.date);
      if (i === undefined) continue;
      addInto(s, i, Number(t.amount));
      tr("sales:Savdo tushumi", i, () => ({ date: t.date, title: cashTitle(t), sub: cashSub(t), amount: Number(t.amount), href: cashDayHref(t.date) }));
    }
    sales.set("Savdo tushumi", s);
  }

  // ── Kassa: PNL qatori → manba → oylar (xarajat musbat; teskari yozuv — qaytgan pul — ayiriladi) ──
  const byLine = new Map<PnlLine | "UNKNOWN", Map<string, number[]>>();
  /** `src` — drill-down uchun yozuvning o'zi (jadvalda xarajat manfiy, «Boshqa tushumlar» musbat ko'rinadi). */
  const put = (line: PnlLine | "UNKNOWN", name: string, i: number, v: number, src?: () => Omit<DrillItem, "amount">) => {
    let m = byLine.get(line);
    if (!m) byLine.set(line, (m = new Map()));
    if (!m.has(name)) m.set(name, zeros(n));
    addInto(m.get(name)!, i, v);
    if (src) tr(cashRowKey(line, name), i, () => ({ ...src(), amount: line === "OTHER_INCOME" ? v : -v }));
  };
  // Ish haqi vedomosti orqali to'langan pul (refType «Payroll») — o'z oyiga (vedomost oyi) tegishli. O'sha oy hisoblangan bo'lsa,
  // to'lov qachon bo'lmasin PNL'ga qayta kirmaydi (oktyabr maoshi 5-noyabrda to'lansa, noyabr xarajati bo'lmaydi);
  // hisoblanmagan bo'lsa — vedomost oyiga yoziladi. Qo'lda kiritilgan «Ish haqi» chiqimi — sana oyiga (oy hisoblangan bo'lsa kirmaydi).
  const payRuns = mode === "accrual" ? await payrollRunMonths(txs.filter((t) => t.refType === PAYROLL_REF && t.refId).map((t) => t.refId!), months) : null;
  const accruedMonths = new Set([...payroll.map((p) => p.month), ...(payRuns?.accrued ?? [])]);
  const unaccruedPaid = new Set<string>();
  for (const t of txs) {
    let i = at(t.date);
    if (i === undefined) continue;
    const a = Number(t.amount);
    const r = resolve(t.category, t.subCategory);
    const src = () => ({ date: t.date, title: cashTitle(t), sub: cashSub(t), href: cashDayHref(t.date) });
    if (!r) { put("UNKNOWN", UNKNOWN_CATEGORY, i, t.type === "EXPENSE" ? a : -a, src); continue; }
    const line = r.top.pnlLine;
    if (line === "NONE") continue;
    if (line === "MATERIALS" && mode === "accrual") continue;
    // Kirim hujjati / ta'minot zayavkasi puli — sklad qoldig'iga aylanadi, xarajat skladdan chiqqanda (tannarx yoki «Sklad sarfi»)
    if (mode === "accrual" && t.refType && STOCK_PAY_REFS.has(t.refType)) continue;
    if (line === "PAYROLL" && mode === "accrual") {
      const runMonth = t.refType === PAYROLL_REF && t.refId ? payRuns?.month.get(t.refId) : undefined;
      if (runMonth) {
        if (accruedMonths.has(runMonth)) continue;
        i = idx.get(runMonth);
        if (i === undefined) continue; // hisobot davridan tashqari oyning maoshi
        unaccruedPaid.add(runMonth);
      } else if (r.sub?.name !== DAY_WORKERS_SUB) {
        if (accruedMonths.has(months[i]!)) continue;
        unaccruedPaid.add(months[i]!);
      }
    }
    // Kategoriya turiga ko'ra ishora: kirim kategoriyasida kirim (+), xarajat kategoriyasida chiqim (+)
    const v = (r.top.type === "INCOME") === (t.type === "INCOME") ? a : -a;
    // Qator nomi — jadvaldagi atama («Xodimlar maoshlari», «Zavod xarajatlari»…), loyihada — loyiha nomi
    const name = line === "PROJECT" ? (t.project?.name ?? "Loyiha tanlanmagan") : sheetLine(r.top.name, r.sub?.name);
    put(line, name, i, v, src);
  }
  if (mode === "accrual") {
    for (const p of payroll) {
      const i = idx.get(p.month);
      if (i !== undefined) put("PAYROLL", sheetLine("Ish haqi"), i, (Number(p.gross) + Number(p.employerTax)) * shareOf(p.month), () => ({
        date: monthStart(p.month as MonthKey), title: `Ish haqi vedomosti ${p.docNo}`,
        sub: `hisoblangan ${fmtNum(Number(p.gross))} + ish beruvchi solig'i ${fmtNum(Number(p.employerTax))}`, href: `/ish-haqi/${p.id}`,
      }));
    }
    for (const a of assets) for (const m of months) {
      const v = depreciationIn(a, m) * shareOf(m);
      if (v) put("PRODUCTION", DEPRECIATION_LINE, idx.get(m)!, v, () => ({ date: monthStart(m), title: a.name, sub: `Amortizatsiya · ${a.group} · ${a.lifeMonths} oyga`, href: "/moliya/asosiy-vositalar" }));
    }
    const open = months.filter((m) => unaccruedPaid.has(m));
    if (open.length) notes.push(`${open.map((m) => `${m.slice(5)}.${m.slice(0, 4)}`).join(", ")}: oy yakuni ish haqi vedomosti hali tasdiqlanmagan — «Xodimlar maoshlari» qatorida faqat shu oy uchun to'langan pul (avans); tasdiqlangach hisoblangani bilan almashadi.`);
    if (stockUse) {
      for (const u of stockUse.moves) {
        const i = at(u.date);
        if (i !== undefined && u.value) put("PRODUCTION", `${STOCK_USE_PREFIX}${u.group}`, i, u.value, () => ({
          date: u.date, title: u.name, sub: `${fmtNum(u.qty, 3)} ${u.unit} · ${STOCK_TYPE_LABEL[u.type] ?? u.type}`, href: "/stock/rasxod",
        }));
      }
      if (stockUse.top.length) notes.push(`Retseptda yo'q materiallar (yoqilg'i, ehtiyot qism…) skladdan chiqqanda xarajat — «${STOCK_USE_PREFIX}…» qatorlari. Eng kattalari: ${stockUse.top.join(", ")}.`);
      if (stockUse.twins.length) notes.push(`Retsept materialiga o'xshash, lekin retseptga ulanmagan: ${stockUse.twins.join(", ")} — Sklad'da birlashtiring, aks holda ular tannarxga emas, «Sklad sarfi»ga tushadi.`);
    }
    if (cogsEst.some((v) => v > 0)) notes.push("Retsepti yo'q (yoki katalogga bog'lanmagan) mahsulotlar tannarxi taxminiy — shu birlikdagi retseptli sotuvning tannarx ulushi bo'yicha («shundan taxminiy» qatori). Aniq bo'lishi uchun mahsulotni katalogga bog'lab, retsept kiriting.");
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
  // Sotib oluvchiga qaytarilgan pul — xarajat emas, tushumni kamaytiradi (Daromaddan ayiriladi)
  const refund = lineSum("CUSTOMER_REFUND");
  const income = plus(salesTotal, otherIncome, neg(refund));
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
    row("refund", "Sotib oluvchiga qaytarilgan pul", "sub", neg(refund)),
    ...(mode === "accrual" && uncosted.some((v) => v > 0) ? [row("uncosted", "shundan tannarxi noma'lum tushum", "sub", uncosted, { hint: "Retsepti yoki xomashyo narxi yo'q mahsulotlar" })] : []),
    row("cogs", mode === "accrual" ? "Sotuv tannarxi (xom-ashyo)" : "Sotuv tannarxi (xom-ashyoga to'langan)", "line", neg(cogsTotal), { hint: mode === "accrual" ? "Retsept bo'yicha xom-ashyo × o'rtacha narx (QQSsiz)" : undefined }),
    ...(mode === "accrual" && cogsEst.some((v) => v > 0) ? [row("cogs-est", "shundan taxminiy (retseptsiz mahsulotlar)", "sub", neg(cogsEst), { hint: "Shu birlikdagi retseptli sotuvning tannarx ulushi bo'yicha" })] : []),
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
  const parts: PnlParts = {
    sales: salesTotal, otherIncome, refund, income, cogs: cogsTotal, cogsEst, uncosted, gross,
    prod, admin, comm, unknown, operating, tax, interest, net, projects, dividend, retained,
  };
  return { months, mode, rows: visible, retained, notes, parts };
}

/** Qatorning bolalari: ota qator kaliti → bola kaliti shu qatorga kiradimi (Daromad ← mahsulot guruhlari + boshqa tushumlar). */
const CHILDREN: Record<string, (key: string) => boolean> = {
  income: (k) => k.startsWith("sales:") || k === "other-income" || k === "refund",
  qty: (k) => k.startsWith("qty:"),
  prod: (k) => k.startsWith("prod:"),
  admin: (k) => k.startsWith("admin:"),
  comm: (k) => k.startsWith("comm:"),
  projects: (k) => k.startsWith("PROJECT:"),
};
/** Jami qatorlar — boshqa qatorlardan qo'shiladi (jadvalda xarajat manfiy, shuning uchun hammasi qo'shiluvchi). */
const COMPOSE: Record<string, string[]> = {
  gross: ["income", "cogs"],
  operating: ["gross", "prod", "admin", "comm", "unknown"],
  net: ["operating", "tax", "interest"],
  result: ["net", "projects"],
  retained: ["result", "dividend"],
  // Jadvalda alohida qatori yo'q — statistika kartasi «Xarajatlar»
  expenses: ["prod", "admin", "comm", "unknown", "tax", "interest"],
};
const VIRTUAL: Record<string, string> = { expenses: "Xarajatlar (ishlab chiqarish, ma'muriy, tijoriy, soliq, foiz)" };

/**
 * PNL katagining manbasi: `key` — qator kaliti, `col` — oy ustuni (null — davr jami). Jami qatorlar (Yalpi foyda…) tarkibini,
 * qolganlari tarkibi (bo'lsa) va katakni tashkil qilgan yozuvlarni qaytaradi: kassa yozuvi, reys/zayavka, vedomost, sklad sarfi,
 * amortizatsiya. Hisob `buildPnl` ning o'zi — jadvaldagi son bilan bir xil.
 */
export async function pnlDrill(months: MonthKey[], mode: PnlMode, key: string, col: number | null): Promise<Drill | null> {
  if (col !== null && (col < 0 || col >= months.length)) return null;
  const compose = own(COMPOSE, key), child = own(CHILDREN, key);
  const trace: Trace | undefined = compose ? undefined : { match: (k) => k === key || !!child?.(k), month: col, items: [] };
  const rep = await buildPnl(months, mode, trace);
  const parts = compose ?? rep.rows.filter((r) => r.key !== key && child?.(r.key)).map((r) => r.key);
  return finDrill(rep.rows, periodLabel(months, col), key, col, { parts, items: trace?.items ?? [], compose: !!compose, virtual: own(VIRTUAL, key), isQty: key === "qty" || key.startsWith("qty:") });
}
