/**
 * Til modeli asboblari (tools) — model savolga qarab bazadan kerakli ma'lumotni O'ZI so'raydi.
 * Ilgari modelga faqat tayyor "kesim" berilardi; endi u sana oralig'i, mijoz qidiruvi,
 * ro'yxatlar, kassa, ombor, ishlab chiqarish va reyslarni aniq so'rov bilan oladi.
 *
 * Har bir asbob: nom, tavsif (model shuni o'qib tanlaydi), JSON Schema parametrlar va bajaruvchi.
 * Bajaruvchi modelga qisqa MATN qaytaradi (JSON emas — kam token, o'qish oson).
 * Provayderga bog'liq emas: groq.ts va claude.ts shu ro'yxatni o'z formatiga o'giradi.
 */

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import { loadSales, sum, safeDiv, startOfDay, addDays, type SaleRow } from "@/lib/bi/core";
import { customerBase } from "@/lib/bi/customers";
import { customersCredit } from "@/lib/finance";
import { materialOverview } from "@/lib/bi/stock";
import { plansTab } from "@/lib/bi/plans";
import { aiSnapshot } from "@/lib/bi/ai";
import { moneyShort, fmtNum, date as fmtDate, dateTime as fmtDateTime } from "@/lib/format";

export type JsonSchema = {
  type: "object";
  properties: Record<string, { type: "string" | "integer" | "number" | "boolean"; description: string; enum?: string[] }>;
  required?: string[];
};
export type Tool = { name: string; description: string; parameters: JsonSchema; run: (args: Record<string, unknown>) => Promise<string> };

/* ───────────── Yordamchilar ───────────── */

const DAY = 86400000;
const M = (v: number) => `${moneyShort(v)} so'm`;
const m3 = (v: number) => `${fmtNum(v, 1)} m³`;
const pct = (v: number | null | undefined, f = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${fmtNum(v, f)}%`);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown, def: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : def; };
const like = (s: string): Prisma.StringFilter => ({ contains: s, mode: "insensitive" });
export const appUrl = () => (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const link = (path: string) => `${appUrl()}${path}`;

const ORDER_STATUS: Record<string, string> = { DRAFT: "qoralama", BLOCKED: "bloklangan (limit)", CONFIRMED: "tasdiqlangan", IN_PRODUCTION: "ishlab chiqarishda", DELIVERED: "yetkazilgan", CLOSED: "yopilgan", CANCELLED: "bekor qilingan" };
const TRIP_STATUS: Record<string, string> = { PLANNED: "rejalashtirilgan", LOADED: "yuklangan", ON_ROAD: "yo'lda", DELIVERED: "yetkazilgan", CANCELLED: "bekor qilingan" };
const INVOICE_STATUS: Record<string, string> = { OPEN: "ochiq", PARTIAL: "qisman to'langan", PAID: "to'langan", CANCELLED: "bekor qilingan" };

/** "YYYY-MM-DD" → kun boshi. Noto'g'ri bo'lsa null. */
function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null;
  const d = new Date(`${v.trim()}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

/**
 * Davr: from..to (to — shu kun ham kiradi). Berilmasa — oy boshidan bugungacha
 * (def="today" bo'lsa — faqat bugun). Natijada `to` eksklyuziv (keyingi kun boshi).
 */
function period(a: Record<string, unknown>, def: "month" | "today" | "all" = "month") {
  const today = startOfDay(new Date());
  let from = parseDay(a.from), toIn = parseDay(a.to);
  if (!from && !toIn) {
    if (def === "all") return null;
    from = def === "today" ? today : new Date(today.getFullYear(), today.getMonth(), 1);
    toIn = today;
  } else if (!from) from = toIn!;
  else if (!toIn) toIn = from > today ? from : today;
  const to = addDays(toIn!, 1);
  if (to <= from) throw new Error("Davr noto'g'ri: boshlanish sanasi tugash sanasidan keyin.");
  const days = Math.round((to.getTime() - from.getTime()) / DAY);
  if (days > 400) throw new Error("Davr 400 kundan oshmasin.");
  const label = days === 1 ? fmtDate(from) : `${fmtDate(from)} — ${fmtDate(toIn!)}`;
  return { from, to, days, label };
}

function groupBy<T, K>(rows: T[], key: (r: T) => K) {
  const m = new Map<K, T[]>();
  for (const r of rows) { const k = key(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
  return m;
}

function salesAgg(rows: SaleRow[]) {
  const revenue = sum(rows.map((x) => x.revenue)), cost = sum(rows.map((x) => x.cost));
  return {
    revenue, cost, gross: revenue - cost, margin: safeDiv(revenue - cost, revenue) * 100,
    volume: sum(rows.filter((x) => x.unit === "m3").map((x) => x.qty)),
    orders: new Set(rows.map((x) => x.orderId)).size, customers: new Set(rows.map((x) => x.customerId)).size,
  };
}

const dayKey = (d: Date) => fmtDate(d);

/** Nomlarni taqqoslash uchun soddalashtirish: kichik harf, w→v, x→h kabi eshitilishi bir xil harflar, belgilarsiz. */
export function normalize(s: string) {
  return s.toLowerCase().replace(/['ʻʼ`’]/g, "").replace(/w/g, "v").replace(/x/g, "h").replace(/q/g, "k").replace(/[^a-z0-9а-яё ]+/g, " ").replace(/\s+/g, " ").trim();
}
/** Levenshtein masofasi — qisqa nomlar uchun yetarli. */
export function dist(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/* ───────────── Asboblar ───────────── */

const salesSummary: Tool = {
  name: "sales_summary",
  description: "Sotuv/foyda yig'indisi davr bo'yicha: tushum, m³, zayavka va mijoz soni, o'rtacha chek, yalpi foyda, marja, oldingi davr bilan taqqos; group_by — kun/mahsulot/mijoz/sotuvchi kesimi. Har qanday sana oralig'idagi sotuv, savdo, foyda savoli uchun.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD (standart: oy boshi)" },
      to: { type: "string", description: "YYYY-MM-DD, shu kun kiradi (standart: bugun)" },
      group_by: { type: "string", enum: ["none", "day", "product", "customer", "seller"], description: "Kesim (standart none)" },
    },
  },
  run: async (a) => {
    const p = period(a)!;
    const [rows, prevRows] = await Promise.all([loadSales(p.from, p.to), loadSales(addDays(p.from, -p.days), p.from)]);
    const t = salesAgg(rows), pv = salesAgg(prevRows);
    const out = [
      `Davr: ${p.label} (${p.days} kun). Oldingi ${p.days} kun: ${M(pv.revenue)}, ${pv.orders} zayavka.`,
      rows.length
        ? `Sotuv: ${M(t.revenue)} · ${m3(t.volume)} · ${t.orders} zayavka · ${t.customers} mijoz · o'rtacha chek ${M(safeDiv(t.revenue, t.orders))}`
        : "Bu davrda tasdiqlangan sotuv yo'q (0 so'm).",
      rows.length ? `Yalpi foyda: ${M(t.gross)} · marja ${pct(t.margin)} (tannarx ${M(t.cost)})` : "",
      rows.length && pv.revenue ? `O'zgarish: ${pct(safeDiv(t.revenue - pv.revenue, pv.revenue) * 100, 0)} oldingi davrga nisbatan` : "",
    ];
    const g = str(a.group_by) || "none";
    if (rows.length && g !== "none") {
      const key = g === "day" ? (x: SaleRow) => dayKey(x.date) : g === "product" ? (x: SaleRow) => `${x.code} (${x.product})` : g === "customer" ? (x: SaleRow) => x.customer : (x: SaleRow) => x.seller;
      let groups = [...groupBy(rows, key).entries()].map(([k, rs]) => ({ k, ...salesAgg(rs) }));
      if (g === "day") groups.sort((x, y) => x.k.split(".").reverse().join("").localeCompare(y.k.split(".").reverse().join(""))); else groups.sort((x, y) => y.revenue - x.revenue);
      const shown = groups.slice(0, 31); groups = shown;
      out.push(`${g === "day" ? "Kun" : g === "product" ? "Mahsulot" : g === "customer" ? "Mijoz" : "Sotuvchi"} bo'yicha:`);
      for (const r of groups) out.push(`  ${r.k}: ${M(r.revenue)} · ${m3(r.volume)} · ${r.orders} zayavka${g !== "day" ? ` · marja ${pct(r.margin, 0)}` : ""}`);
    }
    return out.filter(Boolean).join("\n");
  },
};

const ordersList: Tool = {
  name: "orders_list",
  description: "Zayavkalar ro'yxati: raqam, sana, mijoz, mahsulot, m³, summa, holat, yetkazish, sotuvchi, reyslar, havola. Sana/holat/mijoz/raqam filtri.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD (standart: sana filtri yo'q)" },
      to: { type: "string", description: "YYYY-MM-DD, shu kun kiradi" },
      status: { type: "string", enum: ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED", "CANCELLED", "OPEN"], description: "OPEN = tasdiqlangan + ishlab chiqarishda" },
      customer: { type: "string", description: "Mijoz nomi qismi" },
      order_no: { type: "string", description: "Zayavka raqami" },
      limit: { type: "integer", description: "standart 20, maks 50" },
    },
  },
  run: async (a) => {
    const p = period(a, "all");
    const st = str(a.status);
    const where: Prisma.OrderWhereInput = {
      ...(p ? { date: { gte: p.from, lt: p.to } } : {}),
      ...(st === "OPEN" ? { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } } : st && st in ORDER_STATUS ? { status: st as Prisma.EnumOrderStatusFilter["equals"] } : {}),
      ...(str(a.customer) ? { customer: { name: like(str(a.customer)) } } : {}),
      ...(str(a.order_no) ? { orderNo: like(str(a.order_no)) } : {}),
    };
    const take = int(a.limit, 20, 50);
    const [total, orders] = await Promise.all([
      db.order.count({ where }),
      db.order.findMany({ where, include: { customer: { select: { name: true } }, createdBy: { select: { fullName: true } }, items: { include: { product: { select: { code: true } } } }, trips: { where: { status: { not: "CANCELLED" } }, select: { status: true, qtyM3: true } } }, orderBy: { date: "desc" }, take }),
    ]);
    if (!orders.length) return `Zayavka topilmadi${p ? ` (${p.label})` : ""}${st ? `, holat ${st}` : ""}${str(a.customer) ? `, mijoz «${str(a.customer)}»` : ""}.`;
    const lines = orders.map((o) => {
      const total = sum(o.items.map((i) => Number(i.qtyM3) * Number(i.price)));
      const vol = sum(o.items.map((i) => Number(i.qtyM3)));
      const items = o.items.map((i) => `${i.product.code} ${fmtNum(Number(i.qtyM3), 1)}`).join(", ");
      const delivered = sum(o.trips.filter((t) => t.status === "DELIVERED").map((t) => Number(t.qtyM3)));
      return `${o.orderNo} · ${fmtDate(o.date)} · ${o.customer.name} · ${items} (${m3(vol)}) · ${M(total)} · ${ORDER_STATUS[o.status] ?? o.status} · yetkazish ${fmtDate(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""} · ${o.deliveryAddress} · sotuvchi ${o.createdBy.fullName} · ${o.trips.length} reys (yetkazildi ${m3(delivered)})${o.isUrgent ? " · SHOSHILINCH" : ""}${o.onCredit ? " · qarzga" : ""} · ${link(`/orders/${o.id}`)}`;
    });
    const all = sum(orders.flatMap((o) => o.items.map((i) => Number(i.qtyM3) * Number(i.price))));
    return [`Jami ${total} zayavka${p ? ` (${p.label})` : ""}, ko'rsatildi ${orders.length}: summa ${M(all)}`, ...lines].join("\n");
  },
};

const customerFind: Tool = {
  name: "customer_find",
  description: "Mijozni nom/INN/telefon bo'yicha qidirish: kontakt, qarz, kredit limiti va qora ro'yxat, segment, buyurtmalar, oxirgi buyurtma, jami xarid, havola. Mijoz nomi tilga olinsa avval shu.",
  parameters: { type: "object", properties: { query: { type: "string", description: "Nom, INN yoki telefon qismi" } }, required: ["query"] },
  run: async (a) => {
    const q = str(a.query);
    if (!q) return "Xato: qidiruv so'zi bo'sh.";
    const find = (terms: string[]) => db.customer.findMany({ where: { OR: terms.flatMap((t) => [{ name: like(t) }, { inn: { contains: t } }, { phone: { contains: t } }]) }, take: 6, orderBy: { name: "asc" } });
    let found = await find([q]);
    if (!found.length) { const words = q.split(/\s+/).filter((w) => w.length >= 3); if (words.length) found = await find(words); }
    if (!found.length) {
      // Transkript buzilgan bo'lishi mumkin («Owen» → «Oven», «Qurilish» → «Kurilish»):
      // nom yoki uning biror so'zi so'rovga 2 tahrirgacha yaqin bo'lsa — topilgan deb olamiz.
      const all = await db.customer.findMany({ take: 500 });
      const qn = normalize(q);
      const scored = all.map((c) => ({ c, d: Math.min(dist(qn, normalize(c.name)), ...normalize(c.name).split(" ").map((w) => dist(qn, w))) })).filter((x) => x.d <= Math.max(1, Math.floor(qn.length / 4))).sort((a, b) => a.d - b.d);
      if (!scored.length) return `«${q}» bo'yicha mijoz topilmadi (nom, INN, telefon bo'yicha qidirildi).`;
      found = scored.slice(0, 3).map((x) => x.c);
    }
    const [base, credit] = await Promise.all([customerBase(), customersCredit(found.map((c) => c.id))]);
    const rows = new Map(base.map((b) => [b.id, b]));
    return found.map((c) => {
      const b = rows.get(c.id), cr = credit.get(c.id);
      return [
        `${c.name}${c.isActive ? "" : " (nofaol)"} · INN ${c.inn ?? "—"} · tel ${c.phone ?? "—"} · manzil ${c.address ?? "—"} · ro'yxatga olingan ${fmtDate(c.createdAt)}`,
        b ? `  Holat: ${b.segment} · xavf ${b.risk} · ${b.orders} ta buyurtma · oxirgisi ${b.lastOrder ? `${fmtDate(b.lastOrder)} (${b.recency} kun oldin)` : "hali yo'q"} · jami xarid ${M(b.lifetime)} · oyiga o'rtacha ${M(b.avgMonthly)}` : "",
        cr ? `  Qarz: ${M(cr.debt)}${b?.overdueDebt ? ` (muddati o'tgan ${M(b.overdueDebt)}, eng eskisi ${b.oldestDebtDays} kun)` : ""} · schyotsiz ochiq zayavkalar ${M(cr.open)} · limit ${M(cr.limit)}, ishlatilgan ${M(cr.used)}, bo'sh ${M(cr.free)}${cr.blacklisted ? " · QORA RO'YXAT (limit to'liq ishlatilgan)" : ""}` : "",
        b ? `  Tavsiya: ${b.action}` : "",
        `  Sahifa: ${link(`/customers/${c.id}`)}`,
      ].filter(Boolean).join("\n");
    }).join("\n\n");
  },
};

const customersList: Tool = {
  name: "customers_list",
  description: "Mijozlar ro'yxati filtr bilan: all, debtors (qarzdorlar), overdue (muddati o'tgan qarz), blacklist (qora ro'yxat), at_risk, lost, vip, new, active. Telefon, segment, xarid, qarz, oxirgi buyurtma.",
  parameters: {
    type: "object",
    properties: {
      filter: { type: "string", enum: ["all", "debtors", "overdue", "blacklist", "at_risk", "lost", "vip", "new", "active"], description: "standart all" },
      sort: { type: "string", enum: ["debt", "revenue", "recency", "name"], description: "debt/revenue/recency/name" },
      limit: { type: "integer", description: "standart 20, maks 100" },
    },
  },
  run: async (a) => {
    const [base, credit] = await Promise.all([customerBase(), customersCredit()]);
    const f = str(a.filter) || "all";
    let list = base.filter((c) =>
      f === "debtors" ? c.debt > 0 : f === "overdue" ? c.overdueDebt > 0 : f === "blacklist" ? credit.get(c.id)?.blacklisted : f === "at_risk" ? c.segment === "At Risk" : f === "lost" ? c.segment === "Lost" : f === "vip" ? c.segment === "VIP" : f === "new" ? c.segment === "New" || c.segment === "Yangi (xaridsiz)" : f === "active" ? c.recency !== null && c.recency < 30 : true);
    const s = str(a.sort) || (f === "debtors" || f === "overdue" || f === "blacklist" ? "debt" : "revenue");
    list = [...list].sort((x, y) => s === "debt" ? y.debt - x.debt : s === "name" ? x.name.localeCompare(y.name) : s === "recency" ? (x.recency ?? 1e9) - (y.recency ?? 1e9) : y.lifetime - x.lifetime);
    const take = int(a.limit, 20, 100);
    const shown = list.slice(0, take);
    const head = `Jami ${base.length} mijoz · filtr «${f}»: ${list.length} ta (ko'rsatildi ${shown.length}) · ro'yxatdagilar qarzi ${M(sum(list.map((c) => c.debt)))}`;
    if (!shown.length) return head + "\nBu filtrga mos mijoz yo'q.";
    return [head, ...shown.map((c, i) => `${i + 1}. ${c.name} · tel ${c.phone ?? "—"} · ${c.segment} · xarid ${M(c.lifetime)} (${c.orders} buyurtma) · qarz ${M(c.debt)}${c.overdueDebt ? ` (muddati o'tgan ${M(c.overdueDebt)})` : ""} · oxirgi buyurtma ${c.lastOrder ? `${fmtDate(c.lastOrder)}` : "yo'q"}${credit.get(c.id)?.blacklisted ? " · QORA RO'YXAT" : ""}`)].join("\n");
  },
};

const invoicesList: Tool = {
  name: "invoices_list",
  description: "Schyotlar: raqam, sana, mijoz, summa, to'langan, qoldiq, holat, yoshi. open = ochiq/qisman to'langan (debitorka).",
  parameters: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Mijoz nomi qismi" },
      status: { type: "string", enum: ["open", "paid", "all"], description: "standart open" },
      from: { type: "string", description: "YYYY-MM-DD (standart: filtr yo'q)" },
      to: { type: "string", description: "YYYY-MM-DD, shu kun kiradi" },
      limit: { type: "integer", description: "standart 20, maks 50" },
    },
  },
  run: async (a) => {
    const p = period(a, "all"); const st = str(a.status) || "open";
    const where: Prisma.InvoiceWhereInput = {
      ...(p ? { date: { gte: p.from, lt: p.to } } : {}),
      ...(st === "open" ? { status: { in: ["OPEN", "PARTIAL"] } } : st === "paid" ? { status: "PAID" } : {}),
      ...(str(a.customer) ? { customer: { name: like(str(a.customer)) } } : {}),
    };
    const rows = await db.invoice.findMany({ where, include: { customer: { select: { name: true } }, order: { select: { orderNo: true } }, payments: { select: { amount: true } } }, orderBy: { date: "desc" }, take: int(a.limit, 20, 50) });
    if (!rows.length) return "Bu shartga mos schyot yo'q.";
    const today = startOfDay(new Date());
    let amount = 0, paid = 0;
    const lines = rows.map((inv) => {
      const pd = sum(inv.payments.map((x) => Number(x.amount))), am = Number(inv.amount); amount += am; paid += pd;
      const age = Math.floor((today.getTime() - startOfDay(inv.date).getTime()) / DAY);
      return `${inv.invoiceNo} · ${fmtDate(inv.date)} (${age} kun) · ${inv.customer.name} · ${M(am)} · to'langan ${M(pd)} · qoldiq ${M(Math.max(0, am - pd))} · ${INVOICE_STATUS[inv.status] ?? inv.status}${inv.order ? ` · zayavka ${inv.order.orderNo}` : ""}`;
    });
    return [`${rows.length} ta schyot: summa ${M(amount)}, to'langan ${M(paid)}, qoldiq ${M(Math.max(0, amount - paid))}`, ...lines].join("\n");
  },
};

const cashSummary: Tool = {
  name: "cash_summary",
  description: "Kassa/bank davr bo'yicha: mijoz to'lovlari (hisob va mijoz kesimi), boshqa kirim, chiqim kategoriya bo'yicha, sof oqim, hisoblar qoldig'i.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD (standart: oy boshi)" },
      to: { type: "string", description: "YYYY-MM-DD, shu kun kiradi (standart: bugun)" },
    },
  },
  run: async (a) => {
    const p = period(a)!;
    const [pays, txs, accounts, allPay, allTx] = await Promise.all([
      db.payment.findMany({ where: { date: { gte: p.from, lt: p.to } }, include: { customer: { select: { name: true } }, cashAccount: { select: { name: true } } } }),
      db.cashTransaction.findMany({ where: { date: { gte: p.from, lt: p.to } }, include: { cashAccount: { select: { name: true } } } }),
      db.cashAccount.findMany({ where: { isActive: true } }),
      db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
      db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], _sum: { amount: true } }),
    ]);
    const cashIn = sum(pays.map((x) => Number(x.amount)));
    const income = txs.filter((t) => t.type === "INCOME"), expense = txs.filter((t) => t.type === "EXPENSE");
    const inc = sum(income.map((t) => Number(t.amount))), exp = sum(expense.map((t) => Number(t.amount)));
    const top = (rows: { k: string; v: number }[], n = 8) => { const m = new Map<string, number>(); for (const r of rows) m.set(r.k, (m.get(r.k) ?? 0) + r.v); return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n); };
    const out = [
      `Davr: ${p.label} (${p.days} kun)`,
      `Mijozlardan tushum: ${M(cashIn)} (${pays.length} ta to'lov)`,
      ...top(pays.map((x) => ({ k: x.cashAccount.name, v: Number(x.amount) }))).map(([k, v]) => `  hisob ${k}: ${M(v)}`),
      pays.length ? "Eng ko'p to'lagan mijozlar:" : "",
      ...top(pays.map((x) => ({ k: x.customer.name, v: Number(x.amount) }))).map(([k, v]) => `  ${k}: ${M(v)}`),
      `Boshqa kirim: ${M(inc)} (${income.length} ta)`,
      `Chiqim: ${M(exp)} (${expense.length} ta)`,
      ...top(expense.map((x) => ({ k: x.category + (x.counterparty ? ` — ${x.counterparty}` : ""), v: Number(x.amount) })), 10).map(([k, v]) => `  ${k}: ${M(v)}`),
      `Sof oqim: ${M(cashIn + inc - exp)}`,
      "Hisoblar qoldig'i (barcha vaqt bo'yicha):",
      ...accounts.map((acc) => {
        const p0 = Number(allPay.find((x) => x.cashAccountId === acc.id)?._sum.amount ?? 0);
        const i0 = Number(allTx.find((x) => x.cashAccountId === acc.id && x.type === "INCOME")?._sum.amount ?? 0);
        const e0 = Number(allTx.find((x) => x.cashAccountId === acc.id && x.type === "EXPENSE")?._sum.amount ?? 0);
        return `  ${acc.name} (${acc.type === "CASH" ? "naqd" : "bank"}): ${M(p0 + i0 - e0)}`;
      }),
    ];
    return out.filter(Boolean).join("\n");
  },
};

const stockStatus: Tool = {
  name: "stock_status",
  description: "Ombor: xomashyo qoldig'i, kunlik sarf, necha kunga yetadi, zona, 30 kunlik kirim/sarf, buyurtma taklifi; tayyor beton qoldig'i. Nom filtri.",
  parameters: { type: "object", properties: { query: { type: "string", description: "Xomashyo nomi qismi" } } },
  run: async (a) => {
    const q = str(a.query).toLowerCase();
    const [mats, prod] = await Promise.all([
      materialOverview(),
      db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    ]);
    const products = await db.product.findMany({ where: { id: { in: prod.map((x) => x.productId as string) } }, select: { id: true, code: true, unit: true } });
    const rank: Record<string, number> = { Kritik: 0, Xavfli: 1, Yaxshi: 2, "Ma'lumot yo'q": 3 };
    let list = mats;
    if (q) list = mats.filter((m) => m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
    list = [...list].sort((x, y) => rank[x.zone] - rank[y.zone] || x.name.localeCompare(y.name)).slice(0, 40);
    const z = (k: string) => mats.filter((x) => x.zone === k).length;
    const out = [
      `Ombor qiymati ${M(sum(mats.map((x) => x.value)))} · ${mats.length} xomashyo: kritik ${z("Kritik")}, xavfli ${z("Xavfli")}, yaxshi ${z("Yaxshi")}, sarf ma'lumoti yo'q ${z("Ma'lumot yo'q")}`,
      ...(q && !list.length ? [`«${q}» bo'yicha xomashyo topilmadi.`] : []),
      ...list.map((m) => `${m.name} (${m.code}): qoldiq ${fmtNum(m.balance, 1)} ${m.unit} · kuniga ${fmtNum(m.perDay, 1)} ${m.unit} · ${m.days === null ? "sarf yo'q" : `${fmtNum(m.days, 0)} kunga yetadi`} · ${m.zone}${m.short ? " · tasdiqlangan zayavkalarga YETMAYDI" : ""}${m.dead ? " · muzlagan (90 kun ishlatilmagan)" : ""} · 30 kunda kirim ${fmtNum(m.received30, 0)}, sarf ${fmtNum(m.consumed30, 0)} · qiymati ${M(m.value)}${m.suggestQty > 0 ? ` · buyurtma taklifi ${fmtNum(m.suggestQty, 0)} ${m.unit} (${M(m.suggestCost)})` : ""}`),
    ];
    const ps = prod.map((x) => ({ p: products.find((y) => y.id === x.productId), qty: Number(x._sum.qty ?? 0) })).filter((x) => x.p && x.qty !== 0);
    if (ps.length) out.push("Hovlidagi tayyor mahsulot qoldig'i: " + ps.map((x) => `${x.p!.code} ${fmtNum(x.qty, 1)} ${x.p!.unit}`).join(", "));
    return out.join("\n");
  },
};

const productionSummary: Tool = {
  name: "production_summary",
  description: "Ishlab chiqarish davr bo'yicha: zames soni va m³, mahsulot/kun/smena/zayavka kesimi; brigadalarning ochiq topshiriqlari.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD (standart: oy boshi)" },
      to: { type: "string", description: "YYYY-MM-DD, shu kun kiradi (standart: bugun)" },
    },
  },
  run: async (a) => {
    const p = period(a)!;
    const [batches, tasks] = await Promise.all([
      db.productionBatch.findMany({ where: { date: { gte: p.from, lt: p.to } }, include: { product: { select: { code: true } }, order: { select: { orderNo: true, customer: { select: { name: true } } } } }, orderBy: { date: "asc" } }),
      db.brigadeTask.findMany({ where: { status: { in: ["NEW", "IN_PROGRESS"] } }, include: { brigade: { select: { name: true } }, order: { select: { orderNo: true, customer: { select: { name: true } } } }, orderItem: { select: { product: { select: { code: true } } } } }, orderBy: { dueDate: "asc" } }),
    ]);
    const total = sum(batches.map((b) => Number(b.qtyM3)));
    const agg = (key: (b: (typeof batches)[number]) => string) => [...groupBy(batches, key).entries()].map(([k, rs]) => `  ${k}: ${m3(sum(rs.map((b) => Number(b.qtyM3))))} · ${rs.length} zames`);
    const out = [
      `Davr: ${p.label} (${p.days} kun)`,
      batches.length ? `Ishlab chiqarildi: ${m3(total)} · ${batches.length} zames · kuniga o'rtacha ${m3(total / p.days)}` : "Bu davrda zames yo'q.",
      ...(batches.length ? ["Mahsulot bo'yicha:", ...agg((b) => b.product.code)] : []),
      ...(batches.length && p.days <= 31 ? ["Kun bo'yicha:", ...agg((b) => fmtDate(b.date))] : []),
      ...(batches.length ? ["Smena bo'yicha:", ...agg((b) => `${b.shift}-smena`)] : []),
      ...(batches.length ? ["Zayavkalar bo'yicha:", ...agg((b) => b.order ? `${b.order.orderNo} (${b.order.customer.name})` : "zayavkasiz (skladga)").slice(0, 15)] : []),
      `Ochiq topshiriqlar: ${tasks.length} ta, qoldiq ${m3(sum(tasks.map((t) => Number(t.qty) - Number(t.doneQty))))}`,
      ...tasks.slice(0, 15).map((t) => `  ${t.taskNo} · ${t.brigade.name} · ${t.order.orderNo} (${t.order.customer.name}) · ${t.orderItem.product.code} ${fmtNum(Number(t.doneQty), 1)}/${fmtNum(Number(t.qty), 1)} m³ · muddat ${fmtDate(t.dueDate)} · ${t.status === "NEW" ? "yangi" : "bajarilmoqda"}`),
    ];
    return out.join("\n");
  },
};

const tripsList: Tool = {
  name: "trips_list",
  description: "Reyslar va nakladnoylar: raqam, sana, mijoz, zayavka, m³, mashina, haydovchi, holat, chop etish/PDF havolasi; haydovchi bo'yicha yig'indi. Sana/holat/mijoz/haydovchi/raqam filtri.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD (standart: filtr yo'q, oxirgilari)" },
      to: { type: "string", description: "YYYY-MM-DD, shu kun kiradi" },
      status: { type: "string", enum: ["PLANNED", "LOADED", "ON_ROAD", "DELIVERED", "CANCELLED"], description: "Holat" },
      customer: { type: "string", description: "Mijoz nomi qismi" },
      driver: { type: "string", description: "Haydovchi ismi qismi" },
      note_no: { type: "string", description: "Nakladnoy raqami" },
      order_no: { type: "string", description: "Zayavka raqami" },
      limit: { type: "integer", description: "standart 20, maks 50" },
    },
  },
  run: async (a) => {
    const p = period(a, "all"); const st = str(a.status);
    const where: Prisma.TripWhereInput = {
      ...(p ? { createdAt: { gte: p.from, lt: p.to } } : {}),
      ...(st && st in TRIP_STATUS ? { status: st as Prisma.EnumTripStatusFilter["equals"] } : {}),
      ...(str(a.customer) ? { order: { customer: { name: like(str(a.customer)) } } } : {}),
      ...(str(a.order_no) ? { order: { orderNo: like(str(a.order_no)) } } : {}),
      ...(str(a.driver) ? { driver: { fullName: like(str(a.driver)) } } : {}),
      ...(str(a.note_no) ? { deliveryNoteNo: like(str(a.note_no)) } : {}),
    };
    const take = int(a.limit, 20, 50);
    const [total, trips] = await Promise.all([
      db.trip.count({ where }),
      db.trip.findMany({ where, include: { order: { select: { orderNo: true, deliveryAddress: true, customer: { select: { name: true } } } }, vehicle: { select: { plate: true, type: true } }, driver: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take }),
    ]);
    if (!trips.length) return "Bu shartga mos reys/nakladnoy topilmadi.";
    const byDriver = [...groupBy(trips, (t) => t.driver.fullName).entries()].map(([k, rs]) => `  ${k}: ${rs.length} reys · ${m3(sum(rs.map((t) => Number(t.qtyM3))))}`);
    return [
      `Jami ${total} reys${p ? ` (${p.label})` : ""}, ko'rsatildi ${trips.length}: ${m3(sum(trips.map((t) => Number(t.qtyM3))))}, yetkazilgan ${trips.filter((t) => t.status === "DELIVERED").length}`,
      ...trips.map((t) => `Nakladnoy ${t.deliveryNoteNo} · ${fmtDate(t.createdAt)} · ${t.order.customer.name} · ${t.order.orderNo} · ${m3(Number(t.qtyM3))} · ${t.vehicle.plate} · haydovchi ${t.driver.fullName} · ${TRIP_STATUS[t.status] ?? t.status}${t.deliveredAt ? ` (${fmtDateTime(t.deliveredAt)}${t.receiverName ? `, qabul qildi ${t.receiverName}` : ""})` : ""} · ${t.order.deliveryAddress} · chop etish/PDF: ${link(`/trips/${t.id}/print`)}`),
      "Haydovchi bo'yicha:", ...byDriver,
    ].join("\n");
  },
};

const receiptsList: Tool = {
  name: "receipts_list",
  description: "Xomashyo kirimi (yetkazuvchidan): hujjat, sana, yetkazuvchi, xomashyo, miqdor, narx, summa; yetkazuvchi va xomashyo kesimi.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD (standart: oy boshi)" },
      to: { type: "string", description: "YYYY-MM-DD, shu kun kiradi (standart: bugun)" },
      supplier: { type: "string", description: "Yetkazuvchi nomi qismi" },
      material: { type: "string", description: "Xomashyo nomi qismi" },
    },
  },
  run: async (a) => {
    const p = period(a)!;
    const rows = await db.goodsReceiptItem.findMany({
      where: { receipt: { date: { gte: p.from, lt: p.to }, ...(str(a.supplier) ? { supplier: { name: like(str(a.supplier)) } } : {}) }, ...(str(a.material) ? { material: { name: like(str(a.material)) } } : {}) },
      include: { receipt: { select: { docNo: true, date: true, supplier: { select: { name: true } } } }, material: { select: { name: true, unit: true } } },
      orderBy: { receipt: { date: "desc" } }, take: 200,
    });
    if (!rows.length) return `Davrda (${p.label}) kirim yo'q.`;
    const total = sum(rows.map((r) => Number(r.qty) * Number(r.price)));
    const agg = (key: (r: (typeof rows)[number]) => string) => [...groupBy(rows, key).entries()].map(([k, rs]) => `  ${k}: ${M(sum(rs.map((r) => Number(r.qty) * Number(r.price))))} · ${fmtNum(sum(rs.map((r) => Number(r.qty))), 0)} ${rs[0].material.unit}`).slice(0, 12);
    return [
      `Davr: ${p.label} · ${rows.length} pozitsiya · jami ${M(total)}`,
      "Yetkazuvchi bo'yicha:", ...agg((r) => r.receipt.supplier.name),
      "Xomashyo bo'yicha:", ...agg((r) => r.material.name),
      "Oxirgi kirimlar:", ...rows.slice(0, 20).map((r) => `  ${r.receipt.docNo} · ${fmtDate(r.receipt.date)} · ${r.receipt.supplier.name} · ${r.material.name} ${fmtNum(Number(r.qty), 1)} ${r.material.unit} × ${M(Number(r.price))} = ${M(Number(r.qty) * Number(r.price))}`),
    ].join("\n");
  },
};

const planStatus: Tool = {
  name: "plan_status",
  description: "Oylik sotuv rejasi: kompaniya reja/fakt/foiz/prognoz, ish kunlari, kuniga kerak; har sotuvchi reja/fakt/prognoz/signal.",
  parameters: { type: "object", properties: { year: { type: "integer", description: "standart joriy" }, month: { type: "integer", description: "1–12, standart joriy" } } },
  run: async (a) => {
    const now = new Date();
    const y = int(a.year, now.getFullYear(), 2100), m = int(a.month, now.getMonth() + 1, 12);
    const pl = await plansTab(y, m);
    const out = [
      `${y}-${String(m).padStart(2, "0")}: ${pl.wdPassed}/${pl.wdTotal} ish kuni o'tdi`,
      pl.companyPlan
        ? `Reja ${M(pl.companyPlan)} · fakt ${M(pl.fact)} (${pct(pl.pct, 0)}) · prognoz ${M(pl.forecast)} (${pct(pl.fpct, 0)}) · kuniga o'rtacha ${M(pl.avgPerDay)}${pl.needPerDay !== null ? ` · rejaga yetish uchun kuniga ${M(pl.needPerDay)} kerak` : ""}`
        : `Bu oy uchun reja kiritilmagan. Fakt ${M(pl.fact)}, prognoz ${M(pl.forecast)}. Reja: ${link("/bi-tahlil/reja")}`,
      "Sotuvchilar:",
      ...pl.sellers.map((s) => `  ${s.name}: ${s.plan ? `reja ${M(s.plan)} · ` : "reja yo'q · "}fakt ${M(s.fact)}${s.pct !== null ? ` (${pct(s.pct, 0)})` : ""} · prognoz ${M(s.forecast)}${s.fpct !== null ? ` (${pct(s.fpct, 0)})` : ""} · ${s.signal} · ${s.orders} zayavka · 7 kunlik trend ${pct(s.trend, 0)}`),
    ];
    return out.join("\n");
  },
};

const employeesList: Tool = {
  name: "employees_list",
  description: "Xodimlar: ism, lavozim, telefon; lavozim bo'yicha soni. Ism/lavozim qidiruvi.",
  parameters: { type: "object", properties: { query: { type: "string", description: "Ism yoki lavozim qismi" } } },
  run: async (a) => {
    const q = str(a.query);
    const rows = await db.employee.findMany({ where: { isActive: true, ...(q ? { OR: [{ fullName: like(q) }, { position: like(q) }] } : {}) }, orderBy: [{ position: "asc" }, { fullName: "asc" }], take: 100 });
    if (!rows.length) return q ? `«${q}» bo'yicha xodim topilmadi.` : "Faol xodim yo'q.";
    const byPos = [...groupBy(rows, (r) => r.position).entries()].map(([k, rs]) => `${k}: ${rs.length}`).join(", ");
    return [`${rows.length} xodim (${byPos})`, ...rows.map((e) => `${e.fullName} · ${e.position} · tel ${e.phone ?? "—"}`)].join("\n");
  },
};

const vehiclesList: Tool = {
  name: "vehicles_list",
  description: "Texnika: raqam, tur, sig'im, 7 kunda reyslar, bo'sh turganlar.",
  parameters: { type: "object", properties: {} },
  run: async () => {
    const since = addDays(startOfDay(new Date()), -7);
    const rows = await db.vehicle.findMany({ where: { isActive: true }, include: { trips: { where: { createdAt: { gte: since }, status: { not: "CANCELLED" } }, select: { qtyM3: true } } }, orderBy: { plate: "asc" } });
    const T: Record<string, string> = { MIXER: "mikser", PUMP: "nasos", TRUCK: "yuk mashinasi" };
    return [`${rows.length} texnika`, ...rows.map((v) => `${v.plate} · ${T[v.type] ?? v.type}${v.capacityM3 ? ` · ${fmtNum(Number(v.capacityM3), 1)} m³` : ""} · 7 kunda ${v.trips.length} reys (${m3(sum(v.trips.map((t) => Number(t.qtyM3))))})${v.trips.length === 0 ? " · BO'SH TURIBDI" : ""}`)].join("\n");
  },
};

const dashboardSnapshot: Tool = {
  name: "dashboard_snapshot",
  description: "Umumiy holat: health score, xavflar, bugungi vazifalar, oylik sotuv, reja, ombor, qarz, segmentlar, sotuvchilar, prognoz, marketing. Faqat umumiy «holat qanday / nimaga e'tibor / nima qilay» savollari uchun (natija katta).",
  parameters: { type: "object", properties: {} },
  run: () => aiSnapshot(),
};

export const TOOLS: Tool[] = [salesSummary, ordersList, customerFind, customersList, invoicesList, cashSummary, stockStatus, productionSummary, tripsList, receiptsList, planStatus, employeesList, vehiclesList, dashboardSnapshot];

/** Asbob natijasi juda uzun bo'lsa — kontekstni to'ldirmaslik uchun kesiladi. */
const MAX_RESULT = 12000;

/** Model chaqirgan asbobni bajaradi. Xato bo'lsa modelga o'qiladigan xabar qaytadi (istisno emas). */
export async function runTool(tools: Tool[], name: string, rawArgs: unknown): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Xato: «${name}» nomli asbob yo'q. Mavjudlari: ${tools.map((t) => t.name).join(", ")}.`;
  let args: Record<string, unknown> = {};
  try {
    args = typeof rawArgs === "string" ? (rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}) : ((rawArgs as Record<string, unknown>) ?? {});
  } catch {
    return "Xato: asbob argumentlari JSON emas.";
  }
  const t0 = Date.now();
  try {
    const out = await tool.run(args);
    console.log(`[ai tool] ${name} ${JSON.stringify(args)} · ${Date.now() - t0} ms · ${out.length} belgi`);
    return out.length > MAX_RESULT ? out.slice(0, MAX_RESULT) + "\n… (qisqartirildi)" : out;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    console.error(`[ai tool] ${name} xato:`, msg);
    return `Xato: ${msg}`;
  }
}
