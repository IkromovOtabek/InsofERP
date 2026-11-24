import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { loadRevenue, isRealizationRow } from "@/lib/bi/core";
import { pnlReport, pnlSum } from "@/lib/fin-report/pnl";
import { monthKeyOf } from "@/lib/fin-report/period";
import { txSign } from "@/lib/cash-tx";
import { tashkentDay } from "@/lib/nazorat/checks";
import { botEnabled, sendMessage } from "@/lib/telegram/api";
import { publicOrigin } from "@/lib/public-url";
import { fmtNum, moneyShort, dateRu } from "@/lib/format";
import { ORDER_STATUS } from "@/app/(app)/orders/status";

/**
 * «Ma'lumot sog'ligi» (Tahlil, Sarvar rejasi «Yangi qo'shimchalar» 1, 2026-11-24): raqamlar bir-biriga to'g'ri kelmasligining
 * manbasini har kecha avtomatik topadigan tekshiruvlar. Hammasi faqat o'qiydi — mavjud yuklagichlar (`loadRevenue`, PNL,
 * sklad va kassa jurnallari) orqali; natija `DataHealthRun` ga yoziladi, muammo bo'lsa direktorga Telegram.
 * Davr — joriy oy boshidan bugungacha (Bugun paneli bilan bir xil).
 */
export type HealthStatus = "ok" | "warn" | "crit";
export type HealthRow = { label: string; detail: string; href?: string };
export type HealthCheck = { key: string; title: string; status: HealthStatus; value: string; count: number; rows: HealthRow[]; href: string; hint: string };

const MAX_ROWS = 25;
const DAY = 86_400_000;
const EPS = 0.0005;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const q = (n: number) => fmtNum(r3(n), 3);

export const HEALTH_STATUS_LABEL: Record<HealthStatus, string> = { crit: "Shoshilinch", warn: "Tekshirish kerak", ok: "Joyida" };

export async function runDataHealth(opts: { now?: Date } = {}): Promise<HealthCheck[]> {
  const now = opts.now ?? new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + DAY);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * DAY);

  const [rows, products, opening, supply, batches, consume, accounts, txAll, payAll, txBefore, payBefore, txMonth, payMonth, counts, orders, pnl] = await Promise.all([
    loadRevenue(monthStart, tomorrow),
    db.product.findMany({ select: { id: true, name: true, unit: true, isActive: true, price: true, groupId: true, recipes: { where: { isActive: true }, select: { id: true } } } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null }, date: { lt: monthStart } }, _sum: { qty: true } }),
    // Oy ichidagi kirim: ishlab chiqarish, kirim hujjati va musbat inventarizatsiya (o'tkazmalar — juft harakat, kirmaydi)
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null }, date: { gte: monthStart, lt: tomorrow }, qty: { gt: 0 }, type: { in: ["PRODUCTION_OUTPUT", "RECEIPT", "ADJUSTMENT"] } }, _sum: { qty: true } }),
    db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: monthStart, lt: tomorrow } }, select: { qtyM3: true, product: { select: { unit: true } }, recipe: { select: { items: { select: { materialId: true, qtyPerM3: true } } } } } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", materialId: { not: null }, date: { gte: monthStart, lt: tomorrow } }, _sum: { qty: true } }),
    db.cashAccount.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { lt: monthStart } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { lt: monthStart } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { gte: monthStart, lt: tomorrow } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { gte: monthStart, lt: tomorrow } }, _sum: { amount: true } }),
    db.cashCount.findMany({ orderBy: { day: "desc" }, select: { cashAccountId: true, day: true, diff: true } }),
    db.order.findMany({
      where: { kind: "SALE", status: { in: ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION"] }, date: { lt: weekAgo } },
      orderBy: { date: "asc" }, select: { id: true, orderNo: true, date: true, status: true, customer: { select: { name: true } } },
    }),
    pnlReport([monthKeyOf(today)], "accrual").catch(() => null),
  ]);
  const prodById = new Map(products.map((p) => [p.id, p]));
  // Katalogdagi mahsulotga bog'langan qatorlar (zayavka ham, Realizatsiya reestri ham — prodda sotuvning asosiy qismi reestrda)
  const catalogRows = rows.filter((r) => prodById.has(r.productId));
  const out: HealthCheck[] = [];

  // ── 1. Sotilgan dona > ishlab chiqarilgan + oy boshi qoldig'i ──
  {
    const sold = new Map<string, number>();
    for (const r of catalogRows) if (r.unit !== "m3") sold.set(r.productId, (sold.get(r.productId) ?? 0) + r.qty);
    const open = new Map(opening.map((g) => [g.productId!, Number(g._sum.qty ?? 0)]));
    const inMonth = new Map(supply.map((g) => [g.productId!, Number(g._sum.qty ?? 0)]));
    const bad = [...sold].map(([id, s]) => ({ id, s, o: open.get(id) ?? 0, m: inMonth.get(id) ?? 0 })).filter((x) => x.s > x.o + x.m + EPS).sort((a, b) => (b.s - b.o - b.m) - (a.s - a.o - a.m));
    out.push({
      key: "sold_gt_supply", title: "Sotilgan dona > ishlab chiqarilgan + oy boshi qoldig'i", status: bad.length ? "crit" : "ok",
      value: bad.length ? `${bad.length} ta mahsulot` : "Hammasi qoplangan", count: bad.length, href: "/production",
      hint: "Sotuv kiritilgan, lekin ishlab chiqarish (brigada qaydi) yoki kirim kiritilmagan — sklad qoldig'i va tannarx noto'g'ri chiqadi.",
      rows: bad.slice(0, MAX_ROWS).map((x) => ({ label: prodById.get(x.id)?.name ?? x.id, detail: `sotildi ${q(x.s)}, oy boshi ${q(x.o)} + kirim ${q(x.m)} — ${q(x.s - x.o - x.m)} ta ortiqcha`, href: `/recipes/${x.id}` })),
    });
  }

  // ── 2. Beton: sotilgan m³ ≠ ishlab chiqarilgan (zames) m³ ──
  {
    const soldM3 = rows.filter((r) => r.unit === "m3").reduce((s, r) => s + r.qty, 0);
    const madeM3 = batches.filter((b) => b.product.unit === "m3").reduce((s, b) => s + Number(b.qtyM3), 0);
    const diff = soldM3 - madeM3;
    const off = soldM3 > 0 && Math.abs(diff) > Math.max(5, soldM3 * 0.05);
    out.push({
      key: "concrete_mismatch", title: "Beton: sotilgan m³ ≠ ishlab chiqarilgan m³", status: !off ? "ok" : madeM3 < soldM3 * 0.1 ? "crit" : "warn",
      value: soldM3 > 0 ? `sotildi ${fmtNum(soldM3, 1)} m³ · zames ${fmtNum(madeM3, 1)} m³` : "Oyda beton sotuvi yo'q", count: off ? 1 : 0, href: "/production",
      hint: "Beton sotilgani zames (ishlab chiqarish) bilan yozilmasa, xomashyo sarfi va tannarx retsept bo'yicha hisoblanmaydi.",
      rows: off ? [{ label: "Farq", detail: `${diff > 0 ? "sotilgani" : "zamesi"} ${fmtNum(Math.abs(diff), 1)} m³ ko'p`, href: "/production" }] : [],
    });
  }

  // ── 3. Xomashyo sarfi retsept me'yoridan ±10% dan ko'p farq ──
  {
    const norm = new Map<string, number>();
    for (const b of batches) for (const i of b.recipe.items) if (i.materialId) norm.set(i.materialId, (norm.get(i.materialId) ?? 0) + Number(i.qtyPerM3) * Number(b.qtyM3));
    const fact = new Map(consume.map((c) => [c.materialId!, -Number(c._sum.qty ?? 0)]));
    const ids = [...new Set([...norm.keys(), ...fact.keys()])];
    const mats = ids.length ? await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } }) : [];
    const matById = new Map(mats.map((m) => [m.id, m]));
    const bad = ids.map((id) => {
      const n = norm.get(id) ?? 0, f = fact.get(id) ?? 0;
      return { id, n, f, dev: n > EPS ? ((f - n) / n) * 100 : f > EPS ? Infinity : 0 };
    }).filter((x) => Math.abs(x.dev) > 10).sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));
    out.push({
      key: "recipe_deviation", title: "Xomashyo sarfi retsept me'yoridan ±10% dan ko'p farq qiladi", status: bad.length ? "warn" : "ok",
      value: bad.length ? `${bad.length} ta xomashyo` : "Me'yor doirasida", count: bad.length, href: "/stock",
      hint: "Me'yor = zameslar × retsept; haqiqiy = zames sarfi. Katta farq — retsept birligi xato (kg ↔ t), zames yozilmagan yoki sarf qo'lda chiqarilgan.",
      rows: bad.slice(0, MAX_ROWS).map((x) => {
        const m = matById.get(x.id);
        return { label: m?.name ?? x.id, detail: `me'yor ${q(x.n)} ${m?.unit ?? ""}, haqiqiy ${q(x.f)} ${m?.unit ?? ""} — ${Number.isFinite(x.dev) ? `${x.dev > 0 ? "+" : ""}${fmtNum(x.dev, 1)}%` : "me'yorsiz sarf"}`, href: "/stock" };
      }),
    });
  }

  // ── 4. Kassa: oy boshi + kirim − chiqim ± o'tkazmalar = hozirgi qoldiq ──
  {
    type Agg = { cashAccountId: string; type: string; _sum: { amount: unknown } };
    const sumBy = (tx: Agg[], pay: { cashAccountId: string; _sum: { amount: unknown } }[]) => {
      const m = new Map<string, Record<string, number>>();
      for (const g of tx) { const x = m.get(g.cashAccountId) ?? {}; x[g.type] = (x[g.type] ?? 0) + Number(g._sum.amount ?? 0); m.set(g.cashAccountId, x); }
      for (const g of pay) { const x = m.get(g.cashAccountId) ?? {}; x.PAYMENT = (x.PAYMENT ?? 0) + Number(g._sum.amount ?? 0); m.set(g.cashAccountId, x); }
      return m;
    };
    const bal = (x: Record<string, number> | undefined) => Object.entries(x ?? {}).reduce((s, [t, v]) => s + (t === "PAYMENT" ? v : txSign(t) * v), 0);
    const all = sumBy(txAll as Agg[], payAll), before = sumBy(txBefore as Agg[], payBefore), month = sumBy(txMonth as Agg[], payMonth);
    const lastCount = new Map<string, { day: Date; diff: number }>();
    for (const c of counts) if (!lastCount.has(c.cashAccountId)) lastCount.set(c.cashAccountId, { day: c.day, diff: Number(c.diff) });
    const items: (HealthRow & { level: HealthStatus })[] = [];
    for (const a of accounts) {
      const m = month.get(a.id) ?? {};
      const open = bal(before.get(a.id)), now_ = bal(all.get(a.id));
      if (!a.isActive && Math.abs(now_) < 1) continue;
      const inc = (m.INCOME ?? 0) + (m.PAYMENT ?? 0), exp = m.EXPENSE ?? 0, tin = m.TRANSFER_IN ?? 0, tout = m.TRANSFER_OUT ?? 0, op = m.OPENING ?? 0;
      const calc = open + inc - exp + tin - tout + op;
      const eq = `${moneyShort(open)} + ${moneyShort(inc)} − ${moneyShort(exp)} + o'tkazma ${moneyShort(tin)} − ${moneyShort(tout)}${op ? ` + boshl. ${moneyShort(op)}` : ""} = ${moneyShort(calc)}`;
      if (Math.abs(calc - now_) >= 1) items.push({ level: "crit", label: a.name, detail: `${eq}, hozirgi qoldiq ${moneyShort(now_)} — farq ${moneyShort(now_ - calc)} (kelajak sanali yozuv bor)`, href: "/payments" });
      else if (now_ < -0.5) items.push({ level: "crit", label: a.name, detail: `qoldiq manfiy: ${moneyShort(now_)} — kirim yozilmagan yoki chiqim ikki marta yozilgan (${eq})`, href: "/payments" });
      const lc = lastCount.get(a.id);
      if (lc && Math.abs(lc.diff) >= 1) items.push({ level: "warn", label: a.name, detail: `oxirgi sanoq (${dateRu(lc.day)}) farqi ${moneyShort(lc.diff)}`, href: "/payments" });
    }
    out.push({
      key: "cash_reconcile", title: "Kassa: oy boshi + kirim − chiqim ± o'tkazmalar = hozirgi qoldiq", status: items.some((i) => i.level === "crit") ? "crit" : items.length ? "warn" : "ok",
      value: items.length ? `${new Set(items.map((i) => i.label)).size} ta hisob` : "Barcha hisoblar mos", count: items.length, href: "/payments",
      hint: "Har hisob bo'yicha alohida; o'tkazmalar ham kiradi. Manfiy qoldiq va sanoq farqi ham shu yerda.",
      rows: items.slice(0, MAX_ROWS).map(({ label, detail, href }) => ({ label, detail, href })),
    });
  }

  // ── 5. Daromad (QQS'siz) > sotuv (QQS bilan) ──
  {
    const gross = rows.reduce((s, r) => s + r.revenue, 0), net = rows.reduce((s, r) => s + r.net, 0);
    const badRows = rows.filter((r) => r.net > r.revenue + 0.5);
    const pnlIncome = pnl ? pnlSum(pnl.parts, "income") : null;
    const issues: HealthRow[] = [];
    if (net > gross + 0.5) issues.push({ label: "Sotuv", detail: `QQS'siz ${moneyShort(net)} > QQS bilan ${moneyShort(gross)}`, href: "/bi-tahlil/moliya/pnl" });
    if (pnlIncome !== null && pnlIncome > gross + 0.5) issues.push({ label: "PNL daromadi", detail: `${moneyShort(pnlIncome)} > sotuv (QQS bilan) ${moneyShort(gross)} — daromadga sotuvdan tashqari kirim qo'shilgan`, href: "/bi-tahlil/moliya/pnl" });
    for (const r of badRows.slice(0, 10)) issues.push({ label: `${r.customer} — ${r.product}`, detail: `QQS'siz ${moneyShort(r.net)} > QQS bilan ${moneyShort(r.revenue)}`, href: isRealizationRow(r) ? "/sales/realizatsiya" : `/orders/${r.orderId}` });
    out.push({
      key: "net_gt_gross", title: "Daromad (QQS'siz) sotuvdan (QQS bilan) katta", status: issues.length ? "crit" : "ok",
      value: issues.length ? `${issues.length} ta holat` : "Mos", count: issues.length, href: "/bi-tahlil/moliya/pnl",
      hint: "QQS'siz daromad hech qachon QQS bilan sotuvdan katta bo'lmaydi; bo'lsa — daromadga boshqa kirim aralashgan yoki QQS noto'g'ri.",
      rows: issues.slice(0, MAX_ROWS),
    });
  }

  // ── 6. Narxsiz yoki tannarxsiz sotuv ──
  {
    const unpriced = rows.filter((r) => r.qty > 0 && r.price <= 0);
    const uncosted = rows.filter((r) => r.qty > 0 && !r.costKnown);
    const byProduct = new Map<string, { n: number; net: number }>();
    for (const r of uncosted) { const x = byProduct.get(r.product) ?? { n: 0, net: 0 }; x.n++; x.net += r.net; byProduct.set(r.product, x); }
    const uncostedNet = uncosted.reduce((s, r) => s + r.net, 0);
    out.push({
      key: "unpriced_uncosted", title: "Narxsiz yoki tannarxsiz sotuv", status: unpriced.length ? "crit" : uncosted.length ? "warn" : "ok",
      value: unpriced.length || uncosted.length ? `${unpriced.length} ta narxsiz, ${uncosted.length} ta tannarxsiz (${moneyShort(uncostedNet)})` : "Hammasi narxli va tannarxli", count: unpriced.length + uncosted.length, href: "/recipes",
      hint: "Tannarxsiz sotuv yalpi foydani buzadi: retsept kiriting yoki reestr qatorini katalogdagi mahsulotga bog'lang.",
      rows: [
        ...unpriced.slice(0, 10).map((r) => ({ label: `${r.customer} — ${r.product}`, detail: `${q(r.qty)} ${r.unit}, narx 0`, href: isRealizationRow(r) ? "/sales/realizatsiya" : `/orders/${r.orderId}` })),
        ...[...byProduct].sort((a, b) => b[1].net - a[1].net).slice(0, MAX_ROWS).map(([p, x]) => ({ label: p, detail: `${x.n} qator, ${moneyShort(x.net)} tannarxsiz`, href: "/recipes" })),
      ].slice(0, MAX_ROWS),
    });
  }

  // ── 7. Katalog: papkasiz, narxsiz, retseptsiz faol mahsulot ──
  {
    const act = products.filter((p) => p.isActive);
    const flags = act.map((p) => ({ p, f: [!p.groupId ? "papkasiz" : "", Number(p.price) <= 0 ? "narx 0" : "", !p.recipes.length ? "retseptsiz" : ""].filter(Boolean) })).filter((x) => x.f.length);
    const n = (k: string) => flags.filter((x) => x.f.includes(k)).length;
    out.push({
      key: "catalog", title: "Mahsulot katalogi: papkasiz, narxsiz yoki retseptsiz", status: n("papkasiz") ? "crit" : flags.length ? "warn" : "ok",
      value: flags.length ? `papkasiz ${n("papkasiz")}, narx 0 — ${n("narx 0")}, retseptsiz ${n("retseptsiz")}` : "Katalog to'liq", count: flags.length, href: "/recipes",
      hint: "Papkasiz mahsulot hisobotda «Boshqalar»ga tushadi; narxsizi zayavkada 0 bo'lib chiqadi; retseptsizining tannarxi noma'lum.",
      rows: flags.sort((a, b) => b.f.length - a.f.length).slice(0, MAX_ROWS).map((x) => ({ label: x.p.name, detail: x.f.join(", "), href: `/recipes/${x.p.id}` })),
    });
  }

  // ── 8. 7 kundan ortiq ochiq zayavka ──
  out.push({
    key: "open_orders", title: "7 kundan ortiq ochiq zayavka", status: orders.length ? "warn" : "ok",
    value: orders.length ? `${orders.length} ta zayavka` : "Yo'q", count: orders.length, href: "/orders",
    hint: "Yetkazilgani yopilsin, bekor bo'lgani bekor qilinsin — aks holda stockout va «mikser bo'sh» signallari soxta chiqadi.",
    rows: orders.slice(0, MAX_ROWS).map((o) => ({ label: `${o.orderNo} — ${o.customer.name}`, detail: `${dateRu(o.date)} dan beri, holat: ${ORDER_STATUS[o.status].label.toLowerCase()}`, href: `/orders/${o.id}` })),
  });

  return out;
}

export const problemsOf = (checks: HealthCheck[]) => checks.filter((c) => c.status !== "ok").length;

/** Direktor uchun Telegram matni (faqat muammolar). */
export function healthText(checks: HealthCheck[], at: Date, link: string): string {
  const bad = checks.filter((c) => c.status !== "ok");
  return [
    `Insof ERP · Ma'lumot sog'ligi ${dateRu(at)}`,
    `Muammo: ${bad.length} / ${checks.length}`,
    "",
    ...bad.map((c, i) => `${i + 1}. ${c.status === "crit" ? "[!] " : ""}${c.title} — ${c.value}`),
    "",
    `Batafsil: ${link}`,
  ].join("\n");
}

/** Tekshiradi, natijani yozadi; muammo bo'lsa va `notify` — direktorlarga Telegram. `day` — avtomatik yugurish kuni (bir marta). */
export async function saveDataHealthRun(opts: { manual: boolean; now?: Date; notify?: boolean }): Promise<{ id: string; problems: number; notified: number } | null> {
  const now = opts.now ?? new Date();
  const checks = await runDataHealth({ now });
  const problems = problemsOf(checks);
  let run: { id: string };
  try {
    run = await db.dataHealthRun.create({ data: { day: opts.manual ? null : tashkentDay(now), ranAt: now, manual: opts.manual, problems, result: checks as unknown as Prisma.InputJsonValue } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null; // shu kunning avtomatik yugurishi boshqa jarayonda bo'lib o'tgan
    throw e;
  }
  let notified = 0;
  if (opts.notify && problems > 0 && botEnabled()) {
    const [accounts, origin] = await Promise.all([
      db.telegramAccount.findMany({ where: { isBlocked: false, user: { isActive: true, role: "DIRECTOR" } }, select: { chatId: true, userId: true }, orderBy: { linkedAt: "desc" } }),
      publicOrigin().catch(() => ({ origin: "" })),
    ]);
    const text = healthText(checks, now, `${origin.origin}/bi-tahlil/sogliq`);
    const seen = new Set<string>();
    for (const a of accounts) {
      if (!a.userId || seen.has(a.userId)) continue;
      seen.add(a.userId);
      try { await sendMessage(a.chatId, text); notified++; } catch (e) { console.error("[data-health] yuborilmadi", a.userId, e); }
    }
    if (notified) await db.dataHealthRun.update({ where: { id: run.id }, data: { notified } });
  }
  return { id: run.id, problems, notified };
}

export async function lastDataHealthRun() {
  return db.dataHealthRun.findFirst({ orderBy: { ranAt: "desc" } });
}
