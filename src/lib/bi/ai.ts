import { db } from "@/lib/db";
import { moneyShort, fmtNum, date as fmtDate, qty } from "@/lib/format";
import { type Range, parseRange, loadSales, sum, safeDiv, addDays, startOfDay, WEEKDAYS_FULL } from "./core";
import { overviewTab } from "./overview";
import { agentsTab } from "./agents";
import { plansTab } from "./plans";
import { materialOverview } from "./stock";
import { customerBase } from "./customers";
import { forecastTab, anomaliesTab } from "./forecast";
import { salesTab } from "./sales";
import { lossChannels } from "./finance";
import { marketingTab } from "./marketing";

const M = (v: number) => `${moneyShort(v)} so'm`;
const pct = (v: number | null | undefined, f = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${fmtNum(v, f)}%`);

/* ───────────── Kontekst (kerak bo'lganda yuklanadi) ───────────── */

export type AiCtx = ReturnType<typeof makeCtx>;
function makeCtx(range: Range) {
  const today = startOfDay(new Date());
  const cache = new Map<string, Promise<unknown>>();
  const get = <T,>(k: string, f: () => Promise<T>) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k) as Promise<T>; };
  return {
    range, today,
    overview: () => get("overview", () => overviewTab(range)),
    agents: () => get("agents", () => agentsTab(range)),
    plans: () => get("plans", () => plansTab(today.getFullYear(), today.getMonth() + 1)),
    materials: () => get("materials", () => materialOverview()),
    customers: () => get("customers", () => customerBase()),
    forecast: () => get("forecast", () => forecastTab()),
    anomalies: () => get("anomalies", () => anomaliesTab({ days: 30 })),
    sales: () => get("sales", () => salesTab(range, "day", 1, 10, {})),
    loss: () => get("loss", () => lossChannels(range)),
    marketing: () => get("marketing", () => marketingTab(range)),
  };
}

/* ───────────── AI Direktor — bugun nima qilish kerak ───────────── */

export type Risk = { key: string; title: string; money: string; text: string; action: string; href: string; tone: "danger" | "warning" | "info" };

export async function aiDirector(range: Range) {
  const ctx = makeCtx(range);
  const [o, ag, pl, mats] = await Promise.all([ctx.overview(), ctx.agents(), ctx.plans(), ctx.materials()]);
  const risks: Risk[] = [];
  const critical = mats.filter((m) => m.zone === "Kritik" || m.short);
  if (critical.length) risks.push({ key: "stock", title: "Xomashyo tugayapti", money: `${M(sum(critical.map((m) => m.suggestCost)))} buyurtma`, text: `${critical.length} ta xomashyoni BUGUN buyurtma qilish kerak (${critical.slice(0, 3).map((m) => m.name).join(", ")}) — kechiksa tasdiqlangan zayavkalar to'xtaydi, kuniga ${M(o.loss.stockout.value / 7)} foyda ketadi.`, action: "Ombor sahifasidagi buyurtma navbatini tasdiqlang.", href: "/bi-tahlil/ombor", tone: "danger" });
  const atRisk = o.kpis.lost + (await ctx.customers()).filter((c) => c.segment === "At Risk").length;
  if (atRisk) { const cs = await ctx.customers(); const ar = cs.filter((c) => c.segment === "At Risk"); risks.push({ key: "customers", title: "Mijozlar ketyapti", money: `${M(sum(ar.map((c) => c.avgMonthly)))}/oy`, text: `${ar.length} ta mijoz 45+ kun buyurtma bermayapti — ilgari oyiga ${M(sum(ar.map((c) => c.avgMonthly)))} olib kelardi. Yana ${cs.filter((c) => c.segment === "Lost").length} tasi allaqachon yo'qolgan.`, action: `Bugun ${Math.min(ar.length, 10)} ta mijozga qo'ng'iroq qiling — eng kattalari: ${ar.sort((a, b) => b.avgMonthly - a.avgMonthly).slice(0, 3).map((c) => c.name).join(", ")}.`, href: "/bi-tahlil/mijozlar?segment=At+Risk", tone: "warning" }); }
  if (ag.slow.length) risks.push({ key: "agents", title: "Sotuvchilar sekinlashdi", money: `${M(ag.slowLoss)}/kun`, text: `${ag.slow.length} ta sotuvchi o'z odatidan orqada — kuniga ${M(ag.slowLoss)} sotuv. ${ag.slow[0].name} ${ag.slow[0].slowDays} kundan beri kam ishlayapti (${pct(ag.slow[0].slowdown * 100)}).`, action: "Agentlar sahifasida sababini oching — kam zayavkami yoki chek tushganmi.", href: "/bi-tahlil/agentlar", tone: "warning" });
  if (o.loss.riskyDebt > 0) risks.push({ key: "debt", title: "Xavf ostidagi qarz", money: M(o.loss.riskyDebt), text: `${o.loss.riskyDebtors} ta xarid to'xtatgan mijozda ${M(o.loss.riskyDebt)} qarz qolgan. Aloqa uzilgan sari undirish ehtimoli tushadi.`, action: "Eng katta qarzdorlardan boshlab qo'ng'iroq qiling.", href: "/bi-tahlil/mijozlar?debt=yes", tone: "danger" });
  if (o.loss.blockedOrders) risks.push({ key: "blocked", title: "Bloklangan zayavkalar", money: M(o.loss.blockedRevenue), text: `${o.loss.blockedOrders} ta zayavka kredit limit sabab to'xtab turibdi.`, action: "Limitni ko'rib chiqing yoki mijozdan oldindan to'lov so'rang.", href: "/orders?status=BLOCKED", tone: "info" });

  const good: { text: string; href: string }[] = [];
  if (pl.pct !== null && pl.pct >= 100 * (pl.wdPassed / Math.max(1, pl.wdTotal))) good.push({ text: `Oylik reja tempda — ${pct(pl.pct)} bajarildi (${pl.wdPassed}/${pl.wdTotal} ish kuni), prognoz ${pct(pl.fpct)}.`, href: "/bi-tahlil/reja" });
  for (const g of o.goodNews) good.push({ text: g, href: "/bi-tahlil/sotuvlar" });
  if (ag.best) good.push({ text: `Eng kuchli sotuvchi — ${ag.best.name}: ${M(ag.best.revenue)} (${ag.best.orders} zayavka).`, href: "/bi-tahlil/agentlar" });
  const mk = await ctx.marketing(); if (mk.best && mk.best.roas) good.push({ text: `${mk.best.channel} kuchli ishlayapti — ROAS ${fmtNum(mk.best.roas, 2)}x.`, href: "/bi-tahlil/marketing" });

  const summary = [
    `Oy boshidan ${M(o.month.revenue)} sotildi${pl.companyPlan ? ` — rejaning ${pct(pl.pct)} i` : " (reja kiritilmagan)"}.`,
    `Hozirgi temp bilan oy oxirida ${M(o.month.forecast)} — o'tgan oyga nisbatan ${pct(o.month.delta)}.`,
    `Biznes salomatligi ${o.health}/100 (${o.healthLabel}). Xavf ostidagi pul: ${M(o.riskTotal)}.`,
    `${atRisk} ta mijoz xavf ostida, ${o.kpis.debtors} ta qarzdor (${M(o.kpis.receivable)}).`,
  ];
  return { risks: risks.slice(0, 5), good: good.slice(0, 4), summary, tasks: o.tasks, health: o.health, healthLabel: o.healthLabel, generatedAt: new Date() };
}

/* ───────────── Hisobotlar ───────────── */

export type ReportType = "morning" | "evening" | "weekly" | "monthly" | "executive";
export const REPORTS: { key: ReportType; label: string; desc: string }[] = [
  { key: "morning", label: "Morning Report", desc: "Kun boshida: kecha nima bo'ldi, bugun nima kutilmoqda" },
  { key: "evening", label: "Evening Report", desc: "Kun yakuni: sotuv, reyslar, kassa" },
  { key: "weekly", label: "Weekly Report", desc: "Oxirgi 7 kun vs oldingi 7 kun" },
  { key: "monthly", label: "Monthly Report", desc: "Oy boshidan: reja, prognoz, yo'qotishlar" },
  { key: "executive", label: "Executive Report", desc: "Rahbar uchun 1 sahifa: salomatlik, xavf, vazifalar" },
];
export type Report = { title: string; sub: string; sections: { title: string; lines: string[] }[]; hrefs: { label: string; href: string }[] };

export async function aiReport(type: ReportType): Promise<Report> {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
  if (type === "morning" || type === "evening") {
    const [y, t, trips, mats, cs, pay] = await Promise.all([
      loadSales(yesterday, today), loadSales(today, tomorrow),
      db.trip.findMany({ where: { OR: [{ createdAt: { gte: today } }, { order: { deliveryDate: { gte: today, lt: tomorrow } } }], status: { not: "CANCELLED" } }, include: { order: { select: { customer: { select: { name: true } } } } } }),
      materialOverview(), customerBase(),
      db.payment.aggregate({ where: { date: { gte: today } }, _sum: { amount: true } }),
    ]);
    const crit = mats.filter((m) => m.zone === "Kritik" || m.short), debtors = cs.filter((c) => c.overdueDebt > 0).sort((a, b) => b.overdueDebt - a.overdueDebt);
    const delivered = trips.filter((x) => x.status === "DELIVERED");
    if (type === "morning") return {
      title: `Xayrli tong. ${WEEKDAYS_FULL[today.getDay()]}, ${fmtDate(today)}`, sub: "Kun boshi hisoboti",
      sections: [
        { title: "Kecha", lines: [`Sotuv: ${M(sum(y.map((x) => x.revenue)))} · ${new Set(y.map((x) => x.orderId)).size} zayavka · ${qty(sum(y.filter((x) => x.unit === "m3").map((x) => x.qty)))} m³.`] },
        { title: "Bugun kutilmoqda", lines: [`${trips.length} ta reys rejalashtirilgan (${qty(sum(trips.map((x) => Number(x.qtyM3))))} m³): ${[...new Set(trips.map((x) => x.order.customer.name))].slice(0, 5).join(", ") || "reys yo'q"}.`, t.length ? `Bugun allaqachon ${new Set(t.map((x) => x.orderId)).size} ta zayavka kiritildi (${M(sum(t.map((x) => x.revenue)))}).` : "Bugun hali zayavka kiritilmagan."] },
        { title: "Bugun e'tibor bering", lines: [crit.length ? `Xomashyo: ${crit.map((m) => `${m.name} (${m.days === null ? "sarf yo'q" : `${fmtNum(m.days, 0)} kun`})`).slice(0, 4).join(", ")} — bugun buyurtma qiling.` : "Xomashyo zaxirasi yetarli.", debtors.length ? `Qarzdorlar: ${debtors.slice(0, 3).map((c) => `${c.name} (${moneyShort(c.overdueDebt)})`).join(", ")} — muddati o'tgan, qo'ng'iroq qiling.` : "Muddati o'tgan qarz yo'q."] },
      ], hrefs: [{ label: "Ombor", href: "/bi-tahlil/ombor" }, { label: "Mijozlar", href: "/bi-tahlil/mijozlar" }, { label: "Reyslar", href: "/trips" }],
    };
    return {
      title: `Kun yakuni — ${fmtDate(today)}`, sub: "Evening report",
      sections: [
        { title: "Sotuv", lines: [`Bugun ${M(sum(t.map((x) => x.revenue)))} · ${new Set(t.map((x) => x.orderId)).size} zayavka. Kecha ${M(sum(y.map((x) => x.revenue)))} edi (${pct(safeDiv(sum(t.map((x) => x.revenue)) - sum(y.map((x) => x.revenue)), sum(y.map((x) => x.revenue)) || 1) * 100)}).`] },
        { title: "Logistika", lines: [`${delivered.length}/${trips.length} reys yetkazildi · ${qty(sum(delivered.map((x) => Number(x.qtyM3))))} m³.`] },
        { title: "Kassa", lines: [`Bugun kassaga ${M(Number(pay._sum.amount ?? 0))} tushdi.`] },
        { title: "Ertaga", lines: [crit.length ? `${crit.length} ta xomashyo kritik — ertalab birinchi ish buyurtma.` : "Xomashyo bo'yicha shoshilinch ish yo'q."] },
      ], hrefs: [{ label: "Sotuvlar", href: "/bi-tahlil/sotuvlar" }, { label: "Moliya", href: "/bi-tahlil/moliya" }],
    };
  }
  if (type === "weekly") {
    const r: Range = { ...parseRange({ from: addDays(today, -6).toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) }) };
    const s = await salesTab(r, "day", 1, 10, {}); const ag = await agentsTab(r); const k = s.kpis;
    return {
      title: `Haftalik hisobot — ${r.label}`, sub: `taqqoslash: ${r.prevLabel}`,
      sections: [
        { title: "Asosiy raqamlar", lines: [`Sotuv ${M(k.revenue.cur)} (${pct(k.revenue.delta)}), ${k.orders.cur} zayavka (${pct(k.orders.delta)}), ${k.customers.cur} faol mijoz (${pct(k.customers.delta)}).`, `Yalpi foyda ${M(k.gross.cur)} · marja ${pct(k.margin.cur, 1)}.`, `O'rtacha chek ${M(k.avgCheck.cur)} (${pct(k.avgCheck.delta)}).`] },
        { title: "Nima o'sdi / pasaydi", lines: [s.prodMovers[0] ? `Eng katta o'sish: ${s.prodMovers[0].name} +${moneyShort(s.prodMovers[0].diff)}.` : "", s.prodMovers.at(-1) && s.prodMovers.at(-1)!.diff < 0 ? `Eng katta pasayish: ${s.prodMovers.at(-1)!.name} −${moneyShort(Math.abs(s.prodMovers.at(-1)!.diff))}.` : ""].filter(Boolean) },
        { title: "Sotuvchilar", lines: [ag.best ? `Eng yaxshi — ${ag.best.name}: ${M(ag.best.revenue)}.` : "", ag.slow.length ? `${ag.slow.length} ta sotuvchi sekinlashdi (kuniga ${M(ag.slowLoss)}).` : "Sekinlashgan sotuvchi yo'q."].filter(Boolean) },
        { title: "Yo'qotishlar", lines: [`Bekor qilingan: ${M(s.lost.cancelled)} (${s.lost.cancelledOrders} zayavka) · bloklangan: ${M(s.lost.blocked)}.`, `Chegirma: ${M(s.discount)} (${s.discountCount} pozitsiya).`] },
      ], hrefs: [{ label: "Sotuvlar", href: "/bi-tahlil/sotuvlar" }, { label: "Agentlar", href: "/bi-tahlil/agentlar" }],
    };
  }
  const range = parseRange({ period: "month" });
  const [o, pl, loss] = await Promise.all([overviewTab(range), plansTab(today.getFullYear(), today.getMonth() + 1), lossChannels(range)]);
  if (type === "monthly") return {
    title: `Oylik hisobot — ${range.label}`, sub: `${pl.wdPassed}/${pl.wdTotal} ish kuni o'tdi`,
    sections: [
      { title: "Reja va prognoz", lines: [pl.companyPlan ? `Reja ${M(pl.companyPlan)} · fakt ${M(pl.fact)} (${pct(pl.pct)}) · prognoz ${M(pl.forecast)} (${pct(pl.fpct)}).` : `Reja kiritilmagan. Fakt ${M(pl.fact)}, prognoz ${M(pl.forecast)}.`, pl.needPerDay !== null && pl.companyPlan ? `Rejaga yetish uchun kuniga ${M(pl.needPerDay)} kerak (hozirgi temp ${M(pl.avgPerDay)}).` : ""].filter(Boolean) },
      { title: "O'tgan oyga nisbatan", lines: [`Sotuv ${pct(o.month.delta)}. Marja ${pct(o.kpis.margin.cur, 1)} (o'tgan davr ${pct(o.kpis.margin.prev, 1)}). Kassaga tushum ${M(o.kpis.cashIn.cur)} (${pct(o.kpis.cashIn.delta)}).`] },
      { title: "Yo'qotishlar", lines: [`Kuniga ${M(loss.totalPerDay)} yo'qotilmoqda. Eng katta teshik — ${loss.biggest.title} (${loss.biggest.count}).`, `Muzlagan pul: ${M(loss.frozen)} (qarz ${M(loss.riskyDebt)} + dead stock ${M(loss.deadValue)}).`] },
      { title: "Sotuvchilar", lines: [`Bonus zonasida ${pl.dist.bonus}, normal ${pl.dist.normal}, ogohlantirish ${pl.dist.warn}, xavf ${pl.dist.risk}, rejasiz ${pl.dist.noPlan}.`] },
    ], hrefs: [{ label: "Reja nazorati", href: "/bi-tahlil/reja" }, { label: "Moliya", href: "/bi-tahlil/moliya" }],
  };
  return {
    title: "Executive brief", sub: `${fmtDate(today)} · biznes salomatligi ${o.health}/100 (${o.healthLabel})`,
    sections: [
      { title: "Bitta jumla", lines: [`Oy boshidan ${M(o.month.revenue)} sotildi${pl.companyPlan ? ` (reja ${pct(pl.pct)})` : ""}, xavf ostida ${M(o.riskTotal)}, kuniga ${M(loss.totalPerDay)} yo'qotilmoqda.`] },
      { title: "Salomatlik komponentlari", lines: o.components.map((c) => `${c.label}: ${c.score}/20 — ${c.text}.`) },
      { title: "Bugungi 3 vazifa", lines: o.tasks.slice(0, 3).map((t) => `${t.n}. ${t.title} — ${t.text}`) },
      { title: "Yaxshi xabar", lines: o.goodNews.length ? o.goodNews : ["Bu davrda alohida ijobiy signal yo'q."] },
    ], hrefs: [{ label: "Rahbar markazi", href: "/bi-tahlil" }, { label: "Insof AI", href: "/bi-tahlil/ai" }],
  };
}

/* ───────────── AI Chat — savol-javob (qoida asosida, dashboard ma'lumotidan) ───────────── */

export type QA = { key: string; q: string; kw: string[] };
export const CATALOG: { group: string; icon: string; items: QA[] }[] = [
  { group: "Umumiy holat", icon: "dashboard", items: [
    { key: "health", q: "Biznes holati qanday?", kw: ["holat", "salomat", "health", "qanday", "ahvol"] },
    { key: "attention", q: "Nimaga e'tibor berishim kerak?", kw: ["e'tibor", "etibor", "diqqat", "muhim"] },
    { key: "todo", q: "Hozir nima qilishim kerak?", kw: ["nima qil", "vazifa", "qilish kerak"] },
    { key: "fresh", q: "Ma'lumot qachon yangilangan?", kw: ["yangilan", "qachon", "sana"] },
  ] },
  { group: "Sotuv", icon: "payments", items: [
    { key: "today", q: "Bugungi sotuv qancha?", kw: ["bugun", "bugungi"] },
    { key: "month", q: "Bu oyda qancha sotdik?", kw: ["oy", "oyda", "oylik"] },
    { key: "period", q: "Tanlangan davrda sotuv holati", kw: ["davr", "sotuv holati"] },
    { key: "why", q: "Nega sotuv o'zgardi? (sabab tahlili)", kw: ["nega", "sabab", "o'zgar", "tush", "kamay", "o'sdi"] },
    { key: "top", q: "Top mahsulotlar qaysi?", kw: ["top", "eng ko'p", "yaxshi mahsulot", "marka"] },
    { key: "weak", q: "Eng zaif mahsulotlar qaysi?", kw: ["zaif", "kam sotil", "yomon"] },
  ] },
  { group: "Reja", icon: "track_changes", items: [
    { key: "plan", q: "Reja necha foiz bajarildi?", kw: ["reja", "foiz", "bajar"] },
    { key: "behind", q: "Qaysi sotuvchi ortda qolyapti?", kw: ["ortda", "orqada", "qolyap"] },
    { key: "planrisk", q: "Xavf ostidagi sotuvchilar va sabablari", kw: ["xavf ostidagi sotuvchi", "sotuvchi xavf"] },
  ] },
  { group: "Ombor", icon: "inventory_2", items: [
    { key: "stockout", q: "Qaysi xomashyo tugayapti?", kw: ["tugay", "tugadi", "yetmay", "xomashyo"] },
    { key: "stock", q: "Ombor holati qanday?", kw: ["ombor", "sklad", "zaxira"] },
    { key: "order", q: "Bugun nima buyurtma qilishim kerak?", kw: ["buyurtma", "zakaz", "sotib ol"] },
    { key: "draft", q: "Buyurtma loyihasini tayyorla", kw: ["loyiha", "ro'yxat", "tayyorla"] },
  ] },
  { group: "Moliya", icon: "account_balance", items: [
    { key: "profit", q: "Foyda va marja qanday?", kw: ["foyda", "marja", "rentabel"] },
    { key: "debt", q: "Debitorka nega o'sdi? (sabab tahlili)", kw: ["debitor", "qarz", "qarzdor"] },
    { key: "loss", q: "Bugun qancha pul yo'qotyapman?", kw: ["yo'qot", "yoqot", "teshik", "zarar"] },
    { key: "cash", q: "Kassada nima bo'ladi? (cash forecast)", kw: ["kassa", "cash", "naqd", "pul bo'ladi"] },
  ] },
  { group: "Mijozlar", icon: "groups", items: [
    { key: "segments", q: "Mijozlar qanday taqsimlangan?", kw: ["segment", "taqsim", "rfm", "mijozlar qanday"] },
    { key: "churn", q: "Qaysi mijoz ketishi mumkin?", kw: ["ket", "churn", "yo'qol", "at risk"] },
    { key: "active", q: "Faol mijozlar soni nega o'zgardi?", kw: ["faol mijoz", "aktiv"] },
  ] },
  { group: "Agentlar", icon: "badge", items: [
    { key: "agents", q: "Kim eng yaxshi, kim zaif ishlayapti?", kw: ["agent", "sotuvchi", "kim eng", "xodim"] },
    { key: "slow", q: "Kim sekinlashdi va nega?", kw: ["sekin", "sust"] },
  ] },
  { group: "ML tahlil", icon: "auto_graph", items: [
    { key: "forecast", q: "Prognoz nima deydi?", kw: ["prognoz", "bashorat", "kelasi", "keyingi hafta"] },
    { key: "anomaly", q: "Anomaliya bormi? Nima g'alati?", kw: ["anomal", "g'alati", "shubha"] },
  ] },
  { group: "Marketing", icon: "campaign", items: [
    { key: "marketing", q: "Marketing pul qayerga ketyapti?", kw: ["marketing", "reklama", "roas", "kanal"] },
  ] },
  { group: "Tizim haqida", icon: "help_outline", items: [
    { key: "about", q: "Bu tizimda nima bor? Metrikalar ta'rifi", kw: ["tizim", "metrika", "ta'rif", "nima bor"] },
    { key: "healthdef", q: "Health Score qanday hisoblanadi?", kw: ["health score", "ball", "hisoblan"] },
    { key: "fcdef", q: "Prognoz qanday hisoblanadi?", kw: ["prognoz qanday", "model"] },
  ] },
];

export type Answer = { text: string; bullets?: string[]; href?: { label: string; href: string }; key: string };

export function matchQuestion(q: string): string | null {
  const s = q.toLowerCase();
  let best: { key: string; score: number } | null = null;
  for (const g of CATALOG) for (const it of g.items) {
    if (s === it.q.toLowerCase()) return it.key;
    const score = it.kw.reduce((n, k) => n + (s.includes(k) ? k.length : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { key: it.key, score };
  }
  return best?.key ?? null;
}

export async function aiAnswer(question: string, sp: Record<string, string | undefined> = {}): Promise<Answer> {
  const range = parseRange(sp); const ctx = makeCtx(range);
  const key = matchQuestion(question);
  const L = (label: string, href: string) => ({ label, href });
  switch (key) {
    case "health": { const o = await ctx.overview(); return { key, text: `Biznes salomatligi ${o.health}/100 — ${o.healthLabel}. Xavf ostidagi pul ${M(o.riskTotal)}, kuniga ${M(o.loss.totalPerDay)} yo'qotilmoqda.`, bullets: o.components.map((c) => `${c.label}: ${c.score}/20 — ${c.text}`), href: L("Rahbar markazi", "/bi-tahlil") }; }
    case "attention": { const d = await aiDirector(range); return { key, text: d.risks.length ? `Hozir ${d.risks.length} ta xavf bor. Eng kattasi — ${d.risks[0].title} (${d.risks[0].money}).` : "Shoshilinch xavf yo'q.", bullets: d.risks.map((r) => `${r.title} · ${r.money} — ${r.action}`), href: L("Insof AI", "/bi-tahlil/ai") }; }
    case "todo": { const o = await ctx.overview(); return { key, text: o.tasks.length ? `Bugungi ${o.tasks.length} ta vazifa — pul bo'yicha tartiblangan:` : "Bugun uchun shoshilinch vazifa yo'q.", bullets: o.tasks.map((t) => `${t.n}. ${t.title} (${moneyShort(t.money)}) — ${t.text}`), href: L("Vazifalar", "/bi-tahlil/ai") }; }
    case "fresh": return { key, text: `Ma'lumotlar jonli — har sahifa ochilganda bazadan qayta hisoblanadi. Hozir: ${fmtDate(new Date())} ${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}. Tanlangan davr: ${range.label}.` };
    case "today": { const o = await ctx.overview(); return { key, text: `Bugun ${M(o.todayRevenue)} sotildi (kecha ${M(o.yestRevenue)}, ${pct(o.todayDelta)}). ${qty(o.todayM3)} m³ zayavka, ${o.delivered}/${o.tripsToday} reys yetkazildi.`, href: L("Sotuvlar", "/bi-tahlil/sotuvlar?period=day") }; }
    case "month": { const o = await ctx.overview(); const pl = await ctx.plans(); return { key, text: `Oy boshidan ${M(o.month.revenue)} (${o.month.daysPassed} kun, kuniga ${M(o.month.perDay)}). O'tgan oy ${M(o.month.prev)} edi — ${pct(o.month.delta)}. Oy oxiri prognoz ${M(o.month.forecast)}${pl.companyPlan ? `, reja ${pct(pl.fpct)} bajariladi` : ""}.`, href: L("Sotuvlar", "/bi-tahlil/sotuvlar") }; }
    case "period": { const s = await ctx.sales(); const k = s.kpis; return { key, text: `${range.label}: sotuv ${M(k.revenue.cur)} (${pct(k.revenue.delta)} oldingi davrga), ${k.orders.cur} zayavka, ${k.customers.cur} mijoz, marja ${pct(k.margin.cur, 1)}.`, bullets: [`Hajm ${qty(k.volume.cur)} m³ (${pct(k.volume.delta)})`, `O'rtacha chek ${M(k.avgCheck.cur)}`, `Yalpi foyda ${M(k.gross.cur)}`], href: L("Sotuvlar", "/bi-tahlil/sotuvlar") }; }
    case "why": { const s = await ctx.sales(); const up = s.prodMovers.filter((m) => m.diff > 0).slice(0, 3), down = [...s.prodMovers].reverse().filter((m) => m.diff < 0).slice(0, 3); const cd = [...s.custMovers].reverse().filter((m) => m.diff < 0).slice(0, 3); return { key, text: `Sotuv oldingi davrga nisbatan ${pct(s.kpis.revenue.delta)}. Zayavkalar soni ${pct(s.kpis.orders.delta)}, o'rtacha chek ${pct(s.kpis.avgCheck.delta)} — ${Math.abs(s.kpis.orders.delta ?? 0) > Math.abs(s.kpis.avgCheck.delta ?? 0) ? "asosiy sabab zayavkalar soni (qamrov)" : "asosiy sabab chek hajmi (intensivlik)"}.`, bullets: [...up.map((m) => `▲ ${m.name}: +${moneyShort(m.diff)}`), ...down.map((m) => `▼ ${m.name}: −${moneyShort(Math.abs(m.diff))}`), ...cd.map((m) => `Mijoz ${m.name}: −${moneyShort(Math.abs(m.diff))}`)], href: L("Sabab va imkoniyat", "/bi-tahlil/sotuvlar") }; }
    case "top": { const s = await ctx.sales(); return { key, text: `Top markalar (${range.label}):`, bullets: s.productRows.slice(0, 5).map((p, i) => `${i + 1}. ${p.code} — ${M(p.revenue)} (${pct(p.share, 1)}, ABC ${p.abc}, marja ${pct(p.margin, 1)})`), href: L("Mahsulotlar", "/bi-tahlil/mahsulotlar") }; }
    case "weak": { const s = await ctx.sales(); const w = [...s.productRows].reverse().slice(0, 5); return { key, text: w.length ? "Eng zaif markalar (tushum bo'yicha):" : "Davrda sotuv yo'q.", bullets: w.map((p) => `${p.code} — ${M(p.revenue)} (${pct(p.share, 1)})${p.gross < 0 ? " · zarar bilan" : ""}`), href: L("Mahsulotlar", "/bi-tahlil/mahsulotlar") }; }
    case "plan": { const pl = await ctx.plans(); return { key, text: pl.companyPlan ? `Reja ${M(pl.companyPlan)}, fakt ${M(pl.fact)} — ${pct(pl.pct)} (${pl.wdPassed}/${pl.wdTotal} ish kuni). Prognoz ${M(pl.forecast)} (${pct(pl.fpct)}). ${pl.needPerDay ? `Rejaga yetish uchun kuniga ${M(pl.needPerDay)} kerak.` : "Reja allaqachon bajarilgan."}` : `Bu oy uchun reja kiritilmagan. Fakt ${M(pl.fact)}, prognoz ${M(pl.forecast)}. Reja nazorati sahifasida reja kiriting.`, href: L("Reja nazorati", "/bi-tahlil/reja") }; }
    case "behind": case "planrisk": { const pl = await ctx.plans(); const r = [...pl.risk, ...pl.warn]; return { key, text: r.length ? `${pl.risk.length} ta sotuvchi xavf zonasida (prognoz <70%), ${pl.warn.length} ta ogohlantirishda.` : pl.sellers.some((s) => s.plan) ? "Hamma sotuvchi rejaga mos tempda." : "Sotuvchilarga reja kiritilmagan.", bullets: r.slice(0, 6).map((s) => `${s.name}: reja ${moneyShort(s.plan ?? 0)}, fakt ${moneyShort(s.fact)} (${pct(s.pct)}), prognoz ${pct(s.fpct)} · trend ${pct(s.trend)}`), href: L("Reja nazorati", "/bi-tahlil/reja") }; }
    case "stockout": case "order": case "draft": { const m = await ctx.materials(); const q = m.filter((x) => x.suggestQty > 0 && (x.zone === "Kritik" || x.short || x.zone === "Xavfli")).sort((a, b) => b.suggestCost - a.suggestCost); return { key, text: q.length ? `${q.length} ta xomashyoni buyurtma qilish kerak — jami ${M(sum(q.map((x) => x.suggestCost)))}:` : "Xomashyo zaxirasi yetarli — buyurtma shart emas.", bullets: q.slice(0, 8).map((x) => `${x.name}: qoldiq ${qty(x.balance)} ${x.unit}, ${x.days === null ? "sarf yo'q" : `${fmtNum(x.days, 0)} kunga yetadi`} → ${qty(x.suggestQty)} ${x.unit} (${moneyShort(x.suggestCost)})`), href: L("Ombor · buyurtma navbati", "/bi-tahlil/ombor") }; }
    case "stock": { const m = await ctx.materials(); const z = (k: string) => m.filter((x) => x.zone === k).length; return { key, text: `Ombor qiymati ${M(sum(m.map((x) => x.value)))}. ${m.length} xomashyodan ${z("Kritik")} kritik, ${z("Xavfli")} xavfli, ${z("Yaxshi")} yaxshi. Muzlagan: ${m.filter((x) => x.dead).length} pozitsiya (${M(sum(m.filter((x) => x.dead).map((x) => x.value)))}).`, href: L("Ombor", "/bi-tahlil/ombor") }; }
    case "profit": { const s = await ctx.sales(); const k = s.kpis; return { key, text: `Yalpi foyda ${M(k.gross.cur)} (${pct(k.gross.delta)}), marja ${pct(k.margin.cur, 1)} (oldingi davr ${pct(k.margin.prev, 1)}). ${k.margin.cur < 15 ? "Marja past — retsept tannarxi va narx siyosatini ko'ring." : "Marja sog'lom darajada."}`, bullets: s.opportunity.slice(0, 3).map((p) => `${p.code}: marja ${pct(p.margin, 1)}, sotuv ${moneyShort(p.revenue)}`), href: L("Moliya", "/bi-tahlil/moliya") }; }
    case "debt": { const cs = await ctx.customers(); const d = cs.filter((c) => c.debt > 0).sort((a, b) => b.debt - a.debt); const overdue = sum(cs.map((c) => c.overdueDebt)); return { key, text: `Jami qarz ${M(sum(d.map((c) => c.debt)))} (${d.length} mijoz), shundan muddati o'tgan ${M(overdue)}. Xarid to'xtatganlarda ${M(sum(d.filter((c) => c.segment === "At Risk" || c.segment === "Lost").map((c) => c.debt)))} — bu eng xavflisi.`, bullets: d.slice(0, 5).map((c) => `${c.name}: ${moneyShort(c.debt)}${c.overdueDebt ? ` (muddati o'tgan ${moneyShort(c.overdueDebt)})` : ""} · ${c.segment}`), href: L("Qarzdorlar", "/bi-tahlil/mijozlar?debt=yes") }; }
    case "loss": { const l = await ctx.loss(); return { key, text: `Kuniga ${M(l.totalPerDay)} yo'qotilmoqda (oyiga ≈ ${M(l.totalPerDay * 30)}). Eng katta teshik — ${l.biggest.title}: ${M(l.biggest.perDay)}/kun. Muzlagan pul ${M(l.frozen)}.`, bullets: l.channels.filter((c) => c.perDay > 0).map((c) => `${c.title}: ${moneyShort(c.perDay)}/kun — ${c.action}`), href: L("Moliya", "/bi-tahlil/moliya") }; }
    case "cash": { const o = await ctx.overview(); return { key, text: `Davrda kassaga ${M(o.kpis.cashIn.cur)} tushdi (${pct(o.kpis.cashIn.delta)}). Debitorka ${M(o.kpis.receivable)} — ${o.kpis.debtors} mijozda. 7 kunlik cash forecast Moliya sahifasida.`, href: L("Cash forecast", "/bi-tahlil/moliya") }; }
    case "segments": { const cs = await ctx.customers(); const segs = ["VIP", "Loyal", "Regular", "New", "At Risk", "Lost", "Yangi (xaridsiz)"]; return { key, text: `Jami ${cs.length} mijoz. Faol (30 kun): ${cs.filter((c) => c.recency !== null && c.recency < 30).length}.`, bullets: segs.map((s) => `${s}: ${cs.filter((c) => c.segment === s).length} ta · 180 kun tushum ${moneyShort(sum(cs.filter((c) => c.segment === s).map((c) => c.monetary)))}`), href: L("Mijozlar", "/bi-tahlil/mijozlar") }; }
    case "churn": { const cs = await ctx.customers(); const r = cs.filter((c) => c.segment === "At Risk").sort((a, b) => b.avgMonthly - a.avgMonthly); return { key, text: `${r.length} ta mijoz ketish arafasida (45–89 kun buyurtma yo'q) — oyiga ${M(sum(r.map((c) => c.avgMonthly)))} olib kelardi. Yana ${cs.filter((c) => c.segment === "Lost").length} tasi yo'qolgan (90+ kun).`, bullets: r.slice(0, 6).map((c) => `${c.name}: ${c.recency} kun sukut · oyiga ${moneyShort(c.avgMonthly)}${c.debt ? ` · qarz ${moneyShort(c.debt)}` : ""} — ${c.action}`), href: L("Churn tahlili", "/bi-tahlil/ml/churn") }; }
    case "active": { const o = await ctx.overview(); const s = await ctx.sales(); return { key, text: `Faol mijozlar (30 kun): ${o.kpis.active} / ${o.kpis.total} (${pct(o.kpis.activeRate)}). Davrda xarid qilganlar ${s.kpis.customers.cur} (${pct(s.kpis.customers.delta)} oldingi davrga). O'zgarish sababi — yangi mijozlar oqimi va At Risk ga o'tganlar; Mijozlar sahifasidagi oqim grafigini ko'ring.`, href: L("Mijoz oqimi", "/bi-tahlil/mijozlar") }; }
    case "agents": { const a = await ctx.agents(); return { key, text: `${a.sellers.filter((s) => s.orders > 0).length} sotuvchi ishladi. Eng yaxshi — ${a.best?.name ?? "—"} (${M(a.best?.revenue ?? 0)}). Zayavka sifati: ${pct(a.quality.pct)} tasdiqlangan.`, bullets: [...a.top.map((s) => `▲ ${s.name}: ${moneyShort(s.revenue)} · ${s.orders} zayavka · konversiya ${pct(s.conversion)}`), ...a.bottom.map((s) => `▼ ${s.name}: ${moneyShort(s.revenue)} · konversiya ${pct(s.conversion)}`)], href: L("Agentlar", "/bi-tahlil/agentlar") }; }
    case "slow": { const a = await ctx.agents(); return { key, text: a.slow.length ? `${a.slow.length} ta sotuvchi odatidan orqada — kuniga ${M(a.slowLoss)} sotuv:` : "Sekinlashgan sotuvchi yo'q — hamma odatiy tempda.", bullets: a.slow.slice(0, 6).map((s) => `${s.name}: odatda ${moneyShort(s.usualPerDay)}/kun → hozir ${moneyShort(s.nowPerDay)}/kun (${pct(s.slowdown * 100)}) · sabab: ${s.slowReason}`), href: L("Agentlar", "/bi-tahlil/agentlar") }; }
    case "forecast": { const f = await ctx.forecast(); return { key, text: `Keyingi 7 kunda ≈ ${fmtNum(f.next7, 1)} m³ (${M(f.next7Revenue)}), 30 kunda ≈ ${fmtNum(f.next30, 1)} m³ (${M(f.next30Revenue)}). Trend: ${f.slope > 0.05 ? "o'smoqda" : f.slope < -0.05 ? "pasaymoqda" : "barqaror"}. Model aniqligi WAPE ${pct(f.wape, 1)}${f.wape >= 50 ? " — ehtiyot bilan o'qing" : ""}. ${f.zones.critical} ta xomashyo 7 kun ichida tugaydi.`, href: L("Bashorat", "/bi-tahlil/ml") }; }
    case "anomaly": { const a = await ctx.anomalies(); return { key, text: a.cards.total ? `Oxirgi 30 kunda ${a.cards.total} ta anomaliya: ${a.cards.high} yuqori, ${a.cards.medium} o'rta, ${a.cards.low} past. Ta'sirlangan pul ${M(a.cards.money)}.` : "Oxirgi 30 kunda anomaliya topilmadi.", bullets: a.patterns.sort((x, y) => y.count - x.count).slice(0, 5).map((p) => `${p.pattern}: ${p.count} ta (${p.high} high)`), href: L("Anomaliyalar", "/bi-tahlil/ml/anomaliyalar") }; }
    case "marketing": { const m = await ctx.marketing(); return { key, text: m.has ? `Marketing ${M(m.t.spend)} sarfladi, ${M(m.t.revenue)} sotuv keltirdi — ROAS ${fmtNum(m.t.roas ?? 0, 2)}x, CAC ${M(m.t.cac ?? 0)}, ${m.t.customers} yangi mijoz.` : "Bu davr uchun marketing ma'lumoti kiritilmagan.", bullets: m.verdicts.map((c) => `${c.channel}: ROAS ${fmtNum(c.roas ?? 0, 2)}x — ${c.verdict}`), href: L("Marketing", "/bi-tahlil/marketing") }; }
    case "about": return { key, text: "Insof BI — beton zavodi uchun boshqaruv paneli. Bo'limlar: Rahbar markazi, Sotuvlar, Bekor qilinganlar, Agentlar (sotuvchilar), Mijozlar, Ombor, Mahsulotlar, Ishlab chiqarish, Marketing, Reja nazorati, Moliya, ML tahlil (bashorat, anomaliyalar, churn, klasterlar) va Insof AI.", bullets: ["Sotuv — tasdiqlangan/ishlab chiqarilgan/yetkazilgan/yopilgan zayavkalar tushumi", "Marja — (tushum − retsept tannarxi) / tushum", "RFM — Recency, Frequency, Monetary: mijoz segmentlari", "ABC — tushum ulushi (A 80%, B 95%), XYZ — talab beqarorligi", "Stockout — xomashyo yetmasligidan to'xtagan sotuv", "Dead stock — 90 kun ishlatilmagan xomashyo"] };
    case "healthdef": return { key, text: "Health Score = 5 komponent × 20 ball: debitorka nazorati (muddati o'tgan qarz / oylik sotuv), xomashyo zaxirasi (xavf zonasidagi xomashyo ulushi), marja (maqsad ≥25%), sotuv o'sishi (oldingi davrga), zayavka oqimi (bloklangan va muddati o'tgan). ≥75 sog'lom, 50–74 e'tibor talab, <50 xavfli.", href: L("Rahbar markazi", "/bi-tahlil") };
    case "fcdef": return { key, text: "Bashorat: 60 kunlik kunlik sotuv (m³) qatoridan hafta kuni indeksi olinadi, mavsumiylikdan tozalangan qatorga chiziqli trend o'tkaziladi; kelajak kun = trend × shu kunning indeksi. Aniqlik oxirgi 14 kun backtest bilan (MAE, WAPE, bias) o'lchanadi. Xomashyo ehtiyoji = 14 kunlik bashorat × marka aralashmasi × retsept.", href: L("Bashorat", "/bi-tahlil/ml") };
    default: return { key: "none", text: "Bu savolga hozircha javob bera olmayman. Men dashboard ma'lumotlari asosida javob beraman — sotuv, reja, ombor, moliya, mijozlar, sotuvchilar, prognoz va marketing bo'yicha. Quyidagi tayyor savollardan birini tanlang yoki savolni boshqacha yozing (masalan: «qaysi xomashyo tugayapti», «reja necha foiz», «kim sekinlashdi»)." };
  }
}
