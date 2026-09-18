import { db } from "@/lib/db";
import { type Range, sum, safeDiv, median, delta, startOfDay } from "./core";
import { customerBase } from "./customers";
import { MONTHS_UZ, MONTHS_SHORT } from "./plans";

export const CHANNELS = ["Instagram", "Telegram", "Google Ads", "Facebook", "YouTube", "Influencer", "Banner", "SMS", "OLX / e'lon", "Tavsiya (referal)", "Boshqa"];
export const KIND_LABEL = { BUDGET: "Byudjet (ajratilgan pul)", PLAN: "Reja (natija maqsadlari)", FACT: "Fakt (to'langan xarajat va natija)" } as const;
export type Verdict = "TO'XTATING" | "KAMAYTIRING" | "SAQLANG" | "KO'PAYTIRING" | "MA'LUMOT KAM";

type Entry = { year: number; month: number; kind: "BUDGET" | "PLAN" | "FACT"; channel: string; amount: number; leads: number; customers: number; revenue: number; impressions: number; clicks: number };
const toEntry = (e: { year: number; month: number; kind: "BUDGET" | "PLAN" | "FACT"; channel: string; amount: unknown; leads: number | null; customers: number | null; revenue: unknown; impressions: number | null; clicks: number | null }): Entry => ({ year: e.year, month: e.month, kind: e.kind, channel: e.channel, amount: Number(e.amount), leads: e.leads ?? 0, customers: e.customers ?? 0, revenue: Number(e.revenue ?? 0), impressions: e.impressions ?? 0, clicks: e.clicks ?? 0 });

/** Davrga tegadigan oylar ro'yxati. */
function monthsIn(from: Date, to: Date) { const out: { year: number; month: number }[] = []; for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push({ year: d.getFullYear(), month: d.getMonth() + 1 }); return out; }
const inMonths = (e: Entry, ms: { year: number; month: number }[]) => ms.some((m) => m.year === e.year && m.month === e.month);

function channelStats(list: Entry[]) {
  const fact = list.filter((e) => e.kind === "FACT");
  const spend = sum(fact.map((e) => e.amount)), revenue = sum(fact.map((e) => e.revenue)), leads = sum(fact.map((e) => e.leads)), customers = sum(fact.map((e) => e.customers)), impressions = sum(fact.map((e) => e.impressions)), clicks = sum(fact.map((e) => e.clicks));
  return { spend, revenue, leads, customers, impressions, clicks, roas: spend > 0 ? revenue / spend : null, cac: customers > 0 ? spend / customers : null, cpl: leads > 0 ? spend / leads : null, romi: spend > 0 ? ((revenue - spend) / spend) * 100 : null, profit: revenue - spend, budget: sum(list.filter((e) => e.kind === "BUDGET").map((e) => e.amount)) };
}

/** Marketing tahlili — Team24 "Marketing" ekvivalenti. Ma'lumot MarketingEntry (fakt yozuvlari) dan. */
export async function marketingTab(r: Range) {
  const ms = monthsIn(r.from, r.to), prevMs = monthsIn(r.prevFrom, r.prevTo);
  const [raw, customers] = await Promise.all([db.marketingEntry.findMany(), customerBase()]);
  const all = raw.map(toEntry);
  const cur = all.filter((e) => inMonths(e, ms)), prev = all.filter((e) => inMonths(e, prevMs));
  const t = channelStats(cur), p = channelStats(prev);
  // LTV — ERP mijozlar bazasidan: o'rtacha umrlik tushum (xarid qilganlar)
  const bought = customers.filter((c) => c.lifetime > 0);
  const ltv = bought.length ? sum(bought.map((c) => c.lifetime)) / bought.length : 0;
  const firstCheck = safeDiv(t.revenue, t.customers);
  // ERP dan haqiqiy yangi mijozlar (davrda birinchi buyurtma)
  const erpNew = customers.filter((c) => c.firstOrder && c.firstOrder >= r.from && c.firstOrder < r.to).length;

  const chans = [...new Set(cur.map((e) => e.channel))].map((ch) => { const s = channelStats(cur.filter((e) => e.channel === ch)); const ps = channelStats(prev.filter((e) => e.channel === ch)); return { channel: ch, ...s, prevRoas: ps.roas, trend: s.roas !== null && ps.roas !== null && ps.roas > 0 ? ((s.roas - ps.roas) / ps.roas) * 100 : null }; }).filter((c) => c.spend > 0 || c.budget > 0).sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));
  const med = median(chans.filter((c) => c.roas !== null).map((c) => c.roas as number));
  const verdictOf = (c: typeof chans[number]): Verdict => c.roas === null ? "MA'LUMOT KAM" : c.roas < 1 ? "TO'XTATING" : med > 0 && c.roas < med * 0.6 ? "KAMAYTIRING" : med > 0 && c.roas > med * 1.3 ? "KO'PAYTIRING" : "SAQLANG";
  const verdicts = chans.map((c) => ({ ...c, verdict: verdictOf(c) }));
  const stop = verdicts.filter((c) => c.verdict === "TO'XTATING"), grow = verdicts.filter((c) => c.verdict === "KO'PAYTIRING");
  const freed = sum(stop.map((c) => c.spend)), best = grow[0] ?? verdicts[0] ?? null;
  const reallocGain = best && best.roas ? freed * best.roas * 0.7 : 0;
  const stopLoss = sum(stop.map((c) => c.spend - c.revenue));

  // Trend (oy bo'yicha, davr ichida)
  const trend = ms.map((m) => { const s = channelStats(cur.filter((e) => e.year === m.year && e.month === m.month)); return { label: `${MONTHS_SHORT[m.month - 1]} ${String(m.year).slice(2)}`, ...s }; });
  const funnel = [
    { label: "Ko'rsatishlar", value: t.impressions, cost: safeDiv(t.spend, t.impressions) },
    { label: "Bosishlar", value: t.clicks, cost: safeDiv(t.spend, t.clicks) },
    { label: "Leadlar (murojaat)", value: t.leads, cost: t.cpl ?? 0 },
    { label: "Mijozlar", value: t.customers, cost: t.cac ?? 0 },
  ];
  const signals: { level: "success" | "warning" | "danger" | "info"; title: string; text: string }[] = [];
  if (best && best.roas) signals.push({ level: "success", title: `Eng samarali kanal — ${best.channel}`, text: `ROAS ${best.roas.toFixed(1)}x. Byudjetni shu kanal tomon siljitish mumkin.` });
  for (const c of stop) signals.push({ level: "danger", title: `${c.channel} zarar keltiryapti`, text: `ROAS ${(c.roas ?? 0).toFixed(2)}x — sarflangan puldan kam qaytyapti. To'xtating yoki auditoriyani qayta ko'ring.` });
  for (const c of verdicts.filter((c) => c.verdict === "KAMAYTIRING")) signals.push({ level: "warning", title: `${c.channel} sust ishlayapti`, text: `ROAS ${(c.roas ?? 0).toFixed(1)}x — mediana (${med.toFixed(1)}x) dan past.` });
  if (t.customers && erpNew && Math.abs(t.customers - erpNew) / Math.max(t.customers, erpNew) > 0.3) signals.push({ level: "info", title: "Marketing hisoboti va ERP farq qilyapti", text: `Marketing ${t.customers} ta yangi mijoz deb yozgan, ERP da davrda ${erpNew} ta mijoz birinchi buyurtma bergan. Manbani tekshiring.` });
  if (!cur.length) signals.push({ level: "info", title: "Bu davr uchun ma'lumot kiritilmagan", text: "Marketing ma'lumotlari sahifasida oy × kanal bo'yicha fakt yozuvlarini kiriting." });

  return {
    has: cur.some((e) => e.kind === "FACT"), months: ms, t, p, deltas: { spend: delta(t.spend, p.spend), revenue: delta(t.revenue, p.revenue), leads: delta(t.leads, p.leads), customers: delta(t.customers, p.customers), roas: t.roas !== null && p.roas !== null ? delta(t.roas, p.roas) : null, cac: t.cac !== null && p.cac !== null ? delta(t.cac, p.cac) : null, cpl: t.cpl !== null && p.cpl !== null ? delta(t.cpl, p.cpl) : null, romi: t.romi !== null && p.romi !== null ? delta(t.romi, p.romi) : null },
    ltv, ltvCac: t.cac ? ltv / t.cac : null, firstCheck, conversion: safeDiv(t.customers, t.leads) * 100, erpNew, verdicts, med, stop, grow, freed, best, reallocGain, stopLoss, trend, funnel, signals,
    ctr: safeDiv(t.clicks, t.impressions) * 100, cpm: safeDiv(t.spend, t.impressions) * 1000, cpc: safeDiv(t.spend, t.clicks),
  };
}

/** Marketing reja nazorati — yil/oy bo'yicha reja vs fakt. month = 0 → butun yil. */
export async function marketingPlanTab(year: number, month: number) {
  const today = startOfDay(new Date());
  const raw = await db.marketingEntry.findMany({ where: { year } });
  const all = raw.map(toEntry);
  const sel = month ? all.filter((e) => e.month === month) : all;
  const byChannel = [...new Set(sel.map((e) => e.channel))].map((ch) => {
    const plan = sel.filter((e) => e.channel === ch && e.kind === "PLAN"), fact = sel.filter((e) => e.channel === ch && e.kind === "FACT"), budget = sel.filter((e) => e.channel === ch && e.kind === "BUDGET");
    const P = { spend: sum(plan.map((e) => e.amount)), leads: sum(plan.map((e) => e.leads)), customers: sum(plan.map((e) => e.customers)), revenue: sum(plan.map((e) => e.revenue)) };
    const F = { spend: sum(fact.map((e) => e.amount)), leads: sum(fact.map((e) => e.leads)), customers: sum(fact.map((e) => e.customers)), revenue: sum(fact.map((e) => e.revenue)) };
    return { channel: ch, budget: sum(budget.map((e) => e.amount)), plan: P, fact: F, pct: { spend: P.spend ? (F.spend / P.spend) * 100 : null, leads: P.leads ? (F.leads / P.leads) * 100 : null, customers: P.customers ? (F.customers / P.customers) * 100 : null, revenue: P.revenue ? (F.revenue / P.revenue) * 100 : null }, cac: F.customers ? F.spend / F.customers : null, roas: F.spend ? F.revenue / F.spend : null };
  }).sort((a, b) => b.plan.revenue - a.plan.revenue);
  const totals = { plan: { spend: sum(byChannel.map((c) => c.plan.spend)), leads: sum(byChannel.map((c) => c.plan.leads)), customers: sum(byChannel.map((c) => c.plan.customers)), revenue: sum(byChannel.map((c) => c.plan.revenue)) }, fact: { spend: sum(byChannel.map((c) => c.fact.spend)), leads: sum(byChannel.map((c) => c.fact.leads)), customers: sum(byChannel.map((c) => c.fact.customers)), revenue: sum(byChannel.map((c) => c.fact.revenue)) }, budget: sum(byChannel.map((c) => c.budget)) };
  const monthly = Array.from({ length: 12 }, (_, i) => { const m = i + 1; const plan = all.filter((e) => e.month === m && e.kind === "PLAN"), fact = all.filter((e) => e.month === m && e.kind === "FACT"); return { label: MONTHS_SHORT[i], planRevenue: sum(plan.map((e) => e.revenue)), factRevenue: sum(fact.map((e) => e.revenue)), planSpend: sum(plan.map((e) => e.amount)), factSpend: sum(fact.map((e) => e.amount)), planLeads: sum(plan.map((e) => e.leads)), factLeads: sum(fact.map((e) => e.leads)), planCustomers: sum(plan.map((e) => e.customers)), factCustomers: sum(fact.map((e) => e.customers)) }; });
  const notes: { level: "info" | "warning" | "success" | "danger"; title: string; text: string }[] = [];
  if (month && year === today.getFullYear() && month === today.getMonth() + 1) { const dim = new Date(year, month, 0).getDate(); notes.push({ level: "info", title: `Oy hali tugamagan — ${today.getDate()}/${dim} kun o'tdi (${Math.round((today.getDate() / dim) * 100)}%)`, text: "Bajarilish foizlarini shu nisbatga qarab baholang." }); }
  if (!sel.some((e) => e.kind === "PLAN")) notes.push({ level: "warning", title: "Reja kiritilmagan", text: "Marketing ma'lumotlari sahifasida byudjet va reja kiriting — shundan keyin bu yerda bajarilish ko'rinadi." });
  else {
    const rp = totals.plan.revenue ? (totals.fact.revenue / totals.plan.revenue) * 100 : null;
    if (rp !== null) notes.push({ level: rp >= 100 ? "success" : rp >= 70 ? "info" : "danger", title: `Daromad rejasi ${rp.toFixed(0)}% bajarildi`, text: `Reja ${Math.round(totals.plan.revenue).toLocaleString("ru")} so'm, fakt ${Math.round(totals.fact.revenue).toLocaleString("ru")} so'm.` });
    const over = byChannel.filter((c) => c.pct.spend !== null && c.pct.spend > 110);
    if (over.length) notes.push({ level: "warning", title: `${over.length} ta kanal byudjetdan oshdi`, text: over.map((c) => `${c.channel} (${c.pct.spend!.toFixed(0)}%)`).join(", ") });
  }
  return { year, month, byChannel, totals, monthly, notes, months: MONTHS_UZ };
}

/** Ma'lumotlar sahifasi: ro'yxat + yig'indi. */
export async function marketingEntries(filter: { year?: number; month?: number; channel?: string; kind?: string }) {
  const rows = await db.marketingEntry.findMany({ where: { ...(filter.year ? { year: filter.year } : {}), ...(filter.month ? { month: filter.month } : {}), ...(filter.channel ? { channel: filter.channel } : {}), ...(filter.kind ? { kind: filter.kind as "BUDGET" | "PLAN" | "FACT" } : {}) }, include: { createdBy: { select: { fullName: true } } }, orderBy: [{ year: "desc" }, { month: "desc" }, { channel: "asc" }, { kind: "asc" }] });
  const year = filter.year ?? new Date().getFullYear();
  const yr = (await db.marketingEntry.findMany({ where: { year } })).map(toEntry);
  const budget = sum(yr.filter((e) => e.kind === "BUDGET").map((e) => e.amount)), spent = sum(yr.filter((e) => e.kind === "FACT").map((e) => e.amount)), revenue = sum(yr.filter((e) => e.kind === "FACT").map((e) => e.revenue));
  const years = [...new Set((await db.marketingEntry.findMany({ select: { year: true }, distinct: ["year"] })).map((y) => y.year))].sort((a, b) => b - a);
  return { rows, summary: { year, budget, spent, revenue, count: yr.length, roas: spent ? revenue / spent : null }, years };
}
