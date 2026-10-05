import { db } from "@/lib/db";
import { FLOW_ONLY, balanceFromGroups } from "@/lib/cash-tx";
import { receivablesReport, OWNER_EDGES } from "@/lib/receivables";
import { loadSales, type SaleRow } from "@/lib/bi/core";
import { EXPENSE_KIND, FUEL_TYPE, ISSUE_KIND } from "@/lib/logistics";
import { SUPPLY_LABEL } from "@/lib/supply";
import { procurementHome } from "@/lib/procurement-home";
import { skladLogistika } from "@/lib/sklad-logistika";
import { logisticsDashboard } from "@/lib/logistics-dashboard";
import { ownerPeriod } from "./owner-period";
import { payables } from "./payables";
import { ORDER_LOGI } from "@/lib/logistics";
import { DELIVERY_LABEL, PRIORITY_LABEL } from "@/lib/procurement-const";
import { unitLabel, unitTotals, type UnitRow } from "@/lib/unit";
import { BRIGADE_ISSUE, dayPlan, taskPhase } from "@/lib/brigade-shift";
import { day, inUnit, money, num, pctText, short, shortSigned, sum, time, totalsText, tripQty } from "./fmt";
import { ATT_LABEL, INVOICE_LABEL, MOVE_LABEL, ORDER_LABEL, asOf, dashRange, monthShares, procRange, staffAt, type DashRange } from "./dashboard";
import { parsePeriod } from "./sex";
import { ownerCached } from "./owner-cache";
import { webList } from "./problems";
import { ListError, driverEmployeeId, myBrigadeIds } from "./list";
import type { MobileUser } from "./auth";
import type { DetailField, MobileDetail } from "./detail";
import type { HomeRow, HomeSection, Tone } from "./home";
import type { BrigadeIssueKind, Role } from "@/generated/prisma";

/**
 * Dashboard kartasi bosilganda ochiladigan "batafsil" kartochka — barcha rollar uchun.
 *
 * Kalit: `dash/<karta>.<davr>` — karta bosh ekrandagi `HomeCard.key`, davr esa dashboard filtri bilan
 * bir xil (`day`, `week`, `month`, `year`, `custom~YYYY-MM-DD~YYYY-MM-DD`). Rol foydalanuvchidan olinadi:
 * bitta kalit (masalan `payments`) buxgalter va kassirda bir xil kartochkani ochadi.
 *
 * Har kartochka: yuqorida yig'ma raqamlar (`fields`), pastda tarkib bo'limlari (`sections`) — kesimlar
 * (mahsulot / mijoz / kun…) va hujjatlar ro'yxati. Hujjat qatori bosilsa o'sha hujjat kartochkasi ochiladi
 * (`target`). Ilova hech narsa hisoblamaydi — kartochka to'lig'icha shu yerda tuziladi.
 *
 * Sex (ishlab chiqarish) kartalari `lib/mobile/sex.ts` da alohida — ular davomat tugmalari bilan ishlaydi.
 */

type Part = Pick<MobileDetail, "title" | "subtitle" | "status" | "fields" | "sections">;
type Ctx = { user: MobileUser; r: DashRange };
type Builder = (c: Ctx) => Promise<Part>;

const f = (label: string, value: string, tone?: Tone): DetailField => ({ label, value, tone });
const sec = (title: string, rows: HomeRow[], o: { empty?: string; target?: string; icon?: string } = {}): HomeSection =>
  ({ title, rows, empty: o.empty ?? "Bu davrda ma'lumot yo'q", target: o.target, icon: o.icon });
const pick = (...s: (HomeSection | null | undefined | false)[]) => s.filter((x): x is HomeSection => !!x);
const sumBy = <T,>(rows: T[], v: (x: T) => number) => rows.reduce((s, x) => s + v(x), 0);
const cnt = (n: number, word: string) => `${n} ${word}`;
const share = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "—");
const period = (r: DashRange) => `Davr: ${r.label}`;
/** Oldingi davr maydoni: "1,2 mln · o'tgan oydan ▲ 12%". */
const prevField = (cur: number, prev: number, r: DashRange, fmt: (v: number) => string = money) =>
  f(`Oldingi davr (${r.prevName.replace(/dan$/, "")})`, prev > 0 ? `${fmt(prev)} · ${cur >= prev ? "▲" : "▼"} ${Math.abs(((cur - prev) / prev) * 100).toFixed(0)}%` : fmt(prev));
function groupBy<T>(rows: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of rows) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]); }
  return [...m];
}
/** Kesim bo'limi: guruh → qatorlar soni va yig'indi; eng kattasi tepada. */
function breakdown<T>(title: string, rows: T[], key: (x: T) => string, value: (x: T) => number, fmt: (v: number) => string, o: { icon?: string; unitWord?: string; target?: string; id?: (list: T[]) => string; limit?: number } = {}): HomeSection {
  const total = sumBy(rows, value);
  const groups = groupBy(rows, key).map(([k, list]) => ({ k, list, v: sumBy(list, value) })).sort((a, b) => b.v - a.v).slice(0, o.limit ?? 12);
  return sec(title, groups.map((g, i) => ({
    id: o.id ? o.id(g.list) : `g${i}`, title: g.k, subtitle: `${cnt(g.list.length, o.unitWord ?? "ta")} · ${share(g.v, total)}`, right: fmt(g.v),
  })), { icon: o.icon, target: o.target });
}
const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Kunlar bo'yicha bo'lim — davr bir kundan uzun bo'lsa (yangi kun tepada). */
function byDays<T>(r: DashRange, rows: T[], date: (x: T) => Date, right: (list: T[]) => string, subtitle?: (list: T[]) => string): HomeSection | null {
  if (r.days <= 1) return null;
  const groups = groupBy(rows, (x) => localYmd(date(x))).sort((a, b) => b[0].localeCompare(a[0]));
  return sec("Kunlar bo'yicha", groups.map(([iso, list]) => ({ id: `d-${iso}`, title: iso.split("-").reverse().join("."), subtitle: subtitle ? subtitle(list) : cnt(list.length, "ta"), right: right(list) })), { icon: "calendar" });
}
const unitRows = (rows: { qty: unknown; unit: string }[]): UnitRow[] => rows.map((x) => ({ unit: x.unit, qty: sum(x.qty) }));
const dt = (d: Date) => `${day(d)} ${time(d)}`;
const TRIP_LABEL: Record<string, string> = { PLANNED: "Rejada", LOADED: "Yuklandi", ON_ROAD: "Yo'lda", DELIVERED: "Yetkazildi", CANCELLED: "Bekor" };
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };
const LEAD_LABEL: Record<string, string> = { NEW: "Yangi", IN_PROGRESS: "Bog'lanildi", CONVERTED: "Mijoz bo'ldi", REJECTED: "Bekor" };
const LEAD_TONE: Record<string, Tone> = { NEW: "brand", IN_PROGRESS: "warning", CONVERTED: "success", REJECTED: "danger" };
const SUPPLY_TONE: Record<string, Tone> = { NEW: "info", PRICED: "warning", APPROVED: "warning", FUNDED: "brand", RECEIVED: "success", REJECTED: "danger" };
const ORDER_TONE: Record<string, Tone> = { DRAFT: "info", BLOCKED: "danger", CONFIRMED: "brand", IN_PRODUCTION: "warning", DELIVERED: "success", CLOSED: "success", CANCELLED: "danger" };
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

// ───────────────────────── Sotuv ─────────────────────────

/** Sotuv (hamma yoki bitta sotuvchi) — mahsulot, mijoz, sotuvchi, kun kesimlari va zayavkalar. */
async function salesRevenue(r: DashRange, sellerId?: string, title = "Sotuv"): Promise<Part> {
  const [curAll, prevAll] = await Promise.all([loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo)]);
  const mine = (rows: SaleRow[]) => (sellerId ? rows.filter((x) => x.sellerId === sellerId) : rows);
  const cur = mine(curAll), prev = mine(prevAll);
  const revenue = sumBy(cur, (x) => x.revenue), prevRevenue = sumBy(prev, (x) => x.revenue);
  const orders = groupBy(cur, (x) => x.orderId);
  const rev = (list: SaleRow[]) => short(sumBy(list, (x) => x.revenue));
  return {
    title, subtitle: period(r),
    fields: [
      f("Jami sotuv", money(revenue)),
      f("Zayavkalar", cnt(orders.length, "ta")),
      f("O'rtacha zayavka", orders.length ? money(revenue / orders.length) : "—"),
      f("Hajm", totalsText(unitRows(cur))),
      ...(sellerId && !sellerId.startsWith("*") ? [f("Jamidagi ulush", share(revenue, sumBy(curAll, (x) => x.revenue)))] : []),
      prevField(revenue, prevRevenue, r),
    ],
    sections: pick(
      breakdown("Mahsulotlar bo'yicha", cur, (x) => x.product, (x) => x.revenue, short, { icon: "package", unitWord: "qator" }),
      breakdown("Mijozlar bo'yicha", cur, (x) => x.customer, (x) => x.revenue, short, { icon: "users", unitWord: "qator", target: "customers", id: (l) => l[0]!.customerId, limit: 10 }),
      !sellerId && breakdown("Sotuvchilar bo'yicha", cur, (x) => x.seller, (x) => x.revenue, short, { icon: "user" }),
      byDays(r, cur, (x) => x.date, rev, (l) => cnt(new Set(l.map((x) => x.orderId)).size, "zayavka")),
      sec("Zayavkalar", orders.slice(0, 40).map(([id, list]) => ({
        id, title: `${list[0]!.orderNo} · ${list[0]!.customer}`,
        subtitle: `${day(list[0]!.date)} · ${[...new Set(list.map((x) => x.product))].slice(0, 3).join(", ")} · ${totalsText(unitRows(list))}`,
        right: rev(list), status: ORDER_LABEL[list[0]!.status] ?? list[0]!.status, tone: ORDER_TONE[list[0]!.status],
      })), { target: "orders", empty: "Bu davrda zayavka yo'q" }),
    ),
  };
}

async function salesVolume({ r }: Ctx): Promise<Part> {
  const cur = await loadSales(r.from, r.to);
  const units = unitTotals(unitRows(cur));
  const qtyIn = (list: SaleRow[]) => totalsText(unitRows(list));
  const orders = groupBy(cur, (x) => x.orderId);
  return {
    title: "Hajm", subtitle: period(r),
    fields: [f("Jami hajm", totalsText(unitRows(cur))), f("Zayavkalar", cnt(orders.length, "ta")), ...units.map((u) => f(unitLabel(u.unit), inUnit(u.qty, u.unit)))],
    sections: pick(
      sec("Mahsulotlar bo'yicha", groupBy(cur, (x) => x.product).map(([name, list]) => ({ list, name, q: sumBy(list, (x) => x.qty), unit: list[0]!.unit })).sort((a, b) => b.q - a.q)
        .map((g, i) => ({ id: `p${i}`, title: g.name, subtitle: `${cnt(g.list.length, "qator")} · ${short(sumBy(g.list, (x) => x.revenue))}`, right: inUnit(g.q, g.unit) })), { icon: "package" }),
      sec("Mijozlar bo'yicha", groupBy(cur, (x) => x.customerId).map(([id, list]) => ({ id, list })).sort((a, b) => sumBy(b.list, (x) => x.qty) - sumBy(a.list, (x) => x.qty)).slice(0, 12)
        .map((g) => ({ id: g.id, title: g.list[0]!.customer, subtitle: cnt(new Set(g.list.map((x) => x.orderId)).size, "zayavka"), right: qtyIn(g.list) })), { icon: "users", target: "customers" }),
      byDays(r, cur, (x) => x.date, qtyIn),
      sec("Zayavkalar", orders.slice(0, 40).map(([id, list]) => ({ id, title: `${list[0]!.orderNo} · ${list[0]!.customer}`, subtitle: `${day(list[0]!.date)} · ${[...new Set(list.map((x) => x.product))].slice(0, 3).join(", ")}`, right: qtyIn(list), status: ORDER_LABEL[list[0]!.status], tone: ORDER_TONE[list[0]!.status] })), { target: "orders" }),
    ),
  };
}

async function salesLeads({ r }: Ctx): Promise<Part> {
  const leads = await db.lead.findMany({
    where: { createdAt: { gte: r.from, lt: r.to } }, orderBy: { createdAt: "desc" },
    select: { id: true, name: true, phone: true, status: true, source: true, qty: true, createdAt: true, product: { select: { name: true, unit: true } }, handledBy: { select: { fullName: true } } },
  });
  const by = (s: string) => leads.filter((l) => l.status === s).length;
  const converted = by("CONVERTED");
  return {
    title: "Arizalar", subtitle: period(r),
    fields: [
      f("Jami", cnt(leads.length, "ta")),
      f("Mijozga aylandi", `${converted} · ${share(converted, leads.length)}`, converted ? "success" : undefined),
      f("Bog'lanilmoqda", String(by("IN_PROGRESS"))),
      f("Yangi (ko'rilmagan)", String(by("NEW")), by("NEW") ? "warning" : undefined),
      f("Bekor", String(by("REJECTED"))),
    ],
    sections: pick(
      breakdown("Manba bo'yicha", leads, (l) => l.source, () => 1, (v) => cnt(v, "ta"), { icon: "inbox" }),
      sec("Arizalar", leads.slice(0, 50).map((l) => ({
        id: l.id, title: `${l.name} · ${l.phone}`,
        subtitle: [dt(l.createdAt), l.product ? `${l.product.name}${l.qty ? ` ${inUnit(sum(l.qty), l.product.unit)}` : ""}` : null, l.handledBy?.fullName].filter(Boolean).join(" · "),
        status: LEAD_LABEL[l.status] ?? l.status, tone: LEAD_TONE[l.status],
      })), { target: "leads", empty: "Bu davrda ariza kelmadi" }),
    ),
  };
}

async function salesCustomers({ r }: Ctx): Promise<Part> {
  const rows = await db.customer.findMany({
    where: { createdAt: { gte: r.from, lt: r.to }, isInternal: false }, orderBy: { createdAt: "desc" },
    select: { id: true, name: true, phone: true, createdAt: true, _count: { select: { orders: true } } },
  });
  return {
    title: "Yangi mijozlar", subtitle: period(r),
    fields: [f("Jami", cnt(rows.length, "mijoz")), f("Zayavka ochganlar", String(rows.filter((c) => c._count.orders > 0).length))],
    sections: [sec("Mijozlar", rows.slice(0, 60).map((c) => ({ id: c.id, title: c.name, subtitle: [day(c.createdAt), c.phone].filter(Boolean).join(" · "), right: cnt(c._count.orders, "zayavka") })), { target: "customers", empty: "Bu davrda yangi mijoz yo'q" })],
  };
}

// ───────────────────────── Brigadalar (ish boshqaruvchi / brigadir) ─────────────────────────

const TASK_SELECT = { id: true, taskNo: true, qty: true, doneQty: true, status: true, startedAt: true, dueDate: true, updatedAt: true, brigade: { select: { name: true } }, order: { select: { orderNo: true, customer: { select: { name: true } } } }, orderItem: { select: { product: { select: { name: true, unit: true } } } }, issues: { where: { resolvedAt: null }, select: { kind: true } } } as const;
type TaskRow = { id: string; taskNo: string; qty: unknown; doneQty: unknown; status: "NEW" | "IN_PROGRESS" | "DONE" | "CANCELLED"; startedAt: Date | null; dueDate: Date; updatedAt: Date; brigade: { name: string }; order: { orderNo: string; customer: { name: string } }; orderItem: { product: { name: string; unit: string } }; issues: { kind: BrigadeIssueKind }[] };
const taskRow = (t: TaskRow, right?: string): HomeRow => {
  const ph = taskPhase(t, t.issues.map((i) => i.kind));
  const u = t.orderItem.product.unit;
  return {
    id: t.id, title: `${t.taskNo} · ${t.orderItem.product.name}`,
    subtitle: `${t.brigade.name} · ${t.order.orderNo} ${t.order.customer.name} · muddat ${day(t.dueDate)}`,
    right: right ?? `${inUnit(sum(t.doneQty), u)} / ${inUnit(sum(t.qty), u)}`, status: ph.label, tone: ph.tone,
  };
};
const brigadeWhere = (ids: string[] | null) => (ids ? { brigadeId: { in: ids } } : {});

/** Bajarilgan ish (TaskProgress qaydlari) — brigada, mahsulot, kun kesimi va topshiriqlar. */
async function workDone(r: DashRange, ids: string[] | null, title: string): Promise<Part> {
  const [progress, prev] = await Promise.all([
    db.taskProgress.findMany({
      where: { date: { gte: r.from, lt: r.to }, task: brigadeWhere(ids) }, orderBy: { date: "desc" },
      select: { id: true, qty: true, date: true, createdBy: { select: { fullName: true } }, task: { select: TASK_SELECT } },
    }),
    db.taskProgress.findMany({ where: { date: { gte: r.prevFrom, lt: r.prevTo }, task: brigadeWhere(ids) }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
  ]);
  const rows = progress.map((p) => ({ qty: p.qty, unit: p.task.orderItem.product.unit, date: p.date, brigade: p.task.brigade.name, product: p.task.orderItem.product.name, task: p.task, by: p.createdBy.fullName }));
  const main = unitTotals(unitRows(rows)).sort((a, b) => b.qty - a.qty)[0];
  const inMain = (list: { qty: unknown; unit: string }[]) => (main ? sumBy(list.filter((x) => (x.unit || "m3") === main.unit), (x) => sum(x.qty)) : 0);
  const prevMain = inMain(prev.map((p) => ({ qty: p.qty, unit: p.task.orderItem.product.unit })));
  const tasks = groupBy(rows, (x) => x.task.id);
  return {
    title, subtitle: period(r),
    fields: [
      f("Jami", totalsText(unitRows(rows))),
      f("Qaydlar", cnt(progress.length, "ta")),
      f("Topshiriqlar", cnt(tasks.length, "ta")),
      ...(ids && ids.length === 1 ? [] : [f("Brigadalar", cnt(new Set(rows.map((x) => x.brigade)).size, "ta"))]),
      prevField(main?.qty ?? 0, prevMain, r, (v) => inUnit(v, main?.unit ?? "m3")),
    ],
    sections: pick(
      (!ids || ids.length > 1) && main ? sec("Brigadalar bo'yicha", groupBy(rows, (x) => x.brigade).map(([name, list]) => ({ name, list })).sort((a, b) => inMain(b.list) - inMain(a.list))
        .map((g, i) => ({ id: `b${i}`, title: g.name, subtitle: `${cnt(g.list.length, "qayd")} · ${share(inMain(g.list), main.qty)}`, right: totalsText(unitRows(g.list)) })), { icon: "hard-hat" }) : null,
      sec("Mahsulot bo'yicha", groupBy(rows, (x) => x.product).map(([name, list]) => ({ name, list })).sort((a, b) => sumBy(b.list, (x) => sum(x.qty)) - sumBy(a.list, (x) => sum(x.qty)))
        .map((g, i) => ({ id: `p${i}`, title: g.name, subtitle: cnt(g.list.length, "qayd"), right: totalsText(unitRows(g.list)) })), { icon: "package" }),
      byDays(r, rows, (x) => x.date, (l) => totalsText(unitRows(l)), (l) => cnt(l.length, "qayd")),
      sec("Topshiriqlar bo'yicha", tasks.slice(0, 40).map(([, list]) => taskRow(list[0]!.task, `+${totalsText(unitRows(list))}`)), { target: "tasks", empty: "Bu davrda ish qayd qilinmagan" }),
    ),
  };
}

async function tasksClosed(r: DashRange, ids: string[] | null): Promise<Part> {
  const tasks = await db.brigadeTask.findMany({ where: { ...brigadeWhere(ids), status: "DONE", updatedAt: { gte: r.from, lt: r.to } }, orderBy: { updatedAt: "desc" }, select: TASK_SELECT });
  const rows = tasks.map((t) => ({ qty: t.qty, unit: t.orderItem.product.unit }));
  const onTime = tasks.filter((t) => t.updatedAt <= new Date(t.dueDate.getTime() + 86_400_000)).length;
  return {
    title: "Yopilgan topshiriqlar", subtitle: period(r),
    fields: [f("Jami", cnt(tasks.length, "ta")), f("Hajm", totalsText(unitRows(rows))), f("Muddatida", `${onTime} · ${share(onTime, tasks.length)}`, tasks.length && onTime < tasks.length ? "warning" : undefined)],
    sections: pick(
      (!ids || ids.length > 1) && breakdown("Brigadalar bo'yicha", tasks, (t) => t.brigade.name, () => 1, (v) => cnt(v, "ta"), { icon: "hard-hat" }),
      byDays(r, tasks, (t) => t.updatedAt, (l) => cnt(l.length, "ta")),
      sec("Topshiriqlar", tasks.slice(0, 50).map((t) => taskRow(t, inUnit(sum(t.qty), t.orderItem.product.unit))), { target: "tasks", empty: "Bu davrda yopilgan topshiriq yo'q" }),
    ),
  };
}

/** Ochiq topshiriqlar: `kind` — hammasi / kechikkan / jarayondagi. */
async function tasksOpen(ids: string[] | null, kind: "all" | "overdue" | "inwork", r?: DashRange): Promise<Part> {
  // Davr filtri: muddati davr oxirigacha bo'lgan (kechikkanlari ham) hali ochiq topshiriqlar
  const all = await db.brigadeTask.findMany({ where: { ...brigadeWhere(ids), status: { in: ["NEW", "IN_PROGRESS"] }, ...(r ? { dueDate: { lt: r.to } } : {}) }, orderBy: { dueDate: "asc" }, select: TASK_SELECT });
  const t0 = today0();
  const tasks = kind === "overdue" ? all.filter((t) => t.dueDate < t0) : kind === "inwork" ? all.filter((t) => t.startedAt || t.status === "IN_PROGRESS") : all;
  const left = tasks.map((t) => ({ unit: t.orderItem.product.unit, qty: sum(t.qty) - sum(t.doneQty) }));
  const fresh = all.filter((t) => !t.startedAt && t.status === "NEW").length;
  const blocked = tasks.filter((t) => t.issues.length).length;
  const title = kind === "overdue" ? "Kechikkan topshiriqlar" : kind === "inwork" ? "Jarayondagi topshiriqlar" : "Ochiq topshiriqlar";
  return {
    title, subtitle: r ? `muddati ${period(r)} oxirigacha · hozirgi holat` : "Hozirgi holat",
    fields: [
      f("Jami", cnt(tasks.length, "ta")),
      f("Qolgan hajm", totalsText(left)),
      ...(kind === "all" ? [f("Kechikkan", String(all.filter((t) => t.dueDate < t0).length), all.some((t) => t.dueDate < t0) ? "danger" : undefined), f("Boshlanmagan", String(fresh), fresh ? "warning" : undefined)] : []),
      ...(kind === "inwork" ? [f("Boshlanmagan (yangi)", String(fresh), fresh ? "warning" : undefined)] : []),
      ...(kind === "overdue" && tasks.length ? [f("Eng ko'p kechikish", cnt(daysBetween(tasks[0]!.dueDate, t0), "kun"), "danger")] : []),
      f("Muammo bilan to'xtagan", String(blocked), blocked ? "danger" : undefined),
    ],
    sections: pick(
      (!ids || ids.length > 1) && breakdown("Brigadalar bo'yicha", tasks, (t) => t.brigade.name, () => 1, (v) => cnt(v, "ta"), { icon: "hard-hat" }),
      sec("Topshiriqlar", tasks.slice(0, 60).map((t) => taskRow(t, kind === "overdue" ? `${daysBetween(t.dueDate, t0)} kun kech` : undefined)), { target: "tasks", empty: kind === "overdue" ? "Kechikkan topshiriq yo'q" : "Ochiq topshiriq yo'q" }),
    ),
  };
}

async function brigadesActive({ r }: Ctx): Promise<Part> {
  const [brigades, progress] = await Promise.all([
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { fullName: true } }, _count: { select: { members: true, tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } } } } } } }),
    db.taskProgress.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { qty: true, task: { select: { brigadeId: true, orderItem: { select: { product: { select: { unit: true } } } } } } } }),
  ]);
  const byB = groupBy(progress, (p) => p.task.brigadeId);
  const rows = brigades.map((b) => {
    const list = byB.find(([id]) => id === b.id)?.[1] ?? [];
    return { b, list, done: totalsText(list.map((p) => ({ unit: p.task.orderItem.product.unit, qty: sum(p.qty) }))) };
  }).sort((a, b) => b.list.length - a.list.length);
  const active = rows.filter((x) => x.list.length).length;
  return {
    title: "Brigadalar", subtitle: period(r),
    fields: [f("Faol brigadalar", `${active} / ${brigades.length}`), f("Ish qayd qilmaganlar", String(brigades.length - active), brigades.length - active ? "warning" : undefined), f("Xodimlar", cnt(sumBy(brigades, (b) => b._count.members), "kishi"))],
    sections: [sec("Brigadalar", rows.map(({ b, list, done }) => ({
      id: b.id, title: b.name, subtitle: [b.leader?.fullName, cnt(b._count.members, "kishi"), cnt(b._count.tasks, "ochiq topshiriq")].filter(Boolean).join(" · "),
      right: list.length ? done : "ish yo'q", tone: list.length ? "success" : "warning",
    })), { target: "brigades", empty: "Faol brigada yo'q" })],
  };
}

async function brigadierPlan(r: DashRange, ids: string[]): Promise<Part> {
  if (r.key === "day") {
    const dp = await dayPlan(ids);
    const rows = dp.rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    return {
      title: "Bugungi reja", subtitle: "Muddati bugungacha bo'lgan topshiriqlar",
      fields: [
        ...dp.units.map((u) => f(`Reja (${unitLabel(u.unit)})`, `${inUnit(u.fact, u.unit)} / ${inUnit(u.plan, u.unit)} · ${share(u.fact, u.plan)}`)),
        f("Topshiriqlar", cnt(rows.length, "ta")),
        f("Bajarilganlar", String(rows.filter((t) => t.left <= 0.001).length), "success"),
      ],
      sections: [sec("Topshiriqlar", rows.map((t) => ({
        id: t.id, title: `${t.taskNo} · ${t.product}`, subtitle: `reja ${inUnit(t.plan, t.unit)} · bugun ${inUnit(t.fact, t.unit)} · qoldi ${inUnit(Math.max(0, t.left), t.unit)}`,
        right: pctText(t.plan > 0 ? (t.fact / t.plan) * 100 : null), status: taskPhase(t).label, tone: t.left <= 0.001 ? "success" : t.fact > 0 ? "warning" : "info",
      })), { target: "tasks", empty: "Bugunga reja yo'q" })],
    };
  }
  const tasks = await db.brigadeTask.findMany({ where: { brigadeId: { in: ids }, status: { not: "CANCELLED" }, dueDate: { gte: r.from, lt: r.to } }, orderBy: { dueDate: "asc" }, select: TASK_SELECT });
  const plan = unitRows(tasks.map((t) => ({ qty: t.qty, unit: t.orderItem.product.unit })));
  const done = unitRows(tasks.map((t) => ({ qty: t.doneQty, unit: t.orderItem.product.unit })));
  return {
    title: "Reja", subtitle: `Muddati shu davrda: ${r.label}`,
    fields: [f("Reja", totalsText(plan)), f("Bajarildi", totalsText(done)), f("Topshiriqlar", cnt(tasks.length, "ta")), f("Yopilganlar", String(tasks.filter((t) => t.status === "DONE").length), "success")],
    sections: pick(
      byDays(r, tasks, (t) => t.dueDate, (l) => totalsText(unitRows(l.map((t) => ({ qty: t.qty, unit: t.orderItem.product.unit })))), (l) => cnt(l.length, "topshiriq")),
      sec("Topshiriqlar", tasks.slice(0, 60).map((t) => taskRow(t)), { target: "tasks", empty: "Bu davrga topshiriq yo'q" }),
    ),
  };
}

async function brigadierPct(r: DashRange, ids: string[]): Promise<Part> {
  const [facts, dp, due] = await Promise.all([
    db.taskProgress.findMany({ where: { date: { gte: r.from, lt: r.to }, task: { brigadeId: { in: ids } } }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { name: true, unit: true } } } } } } } }),
    r.key === "day" ? dayPlan(ids) : null,
    r.key === "day" ? [] : db.brigadeTask.findMany({ where: { brigadeId: { in: ids }, status: { not: "CANCELLED" }, dueDate: { gte: r.from, lt: r.to } }, select: { qty: true, orderItem: { select: { product: { select: { name: true, unit: true } } } } } }),
  ]);
  type PF = { product: string; unit: string; plan: number; fact: number };
  const m = new Map<string, PF>();
  const at = (product: string, unit: string) => { const k = m.get(product) ?? { product, unit, plan: 0, fact: 0 }; m.set(product, k); return k; };
  if (dp) for (const t of dp.rows) at(t.product, t.unit).plan += t.plan;
  else for (const t of due) at(t.orderItem.product.name, t.orderItem.product.unit).plan += sum(t.qty);
  for (const p of facts) at(p.task.orderItem.product.name, p.task.orderItem.product.unit).fact += sum(p.qty);
  const rows = [...m.values()].sort((a, b) => b.plan - a.plan);
  const units = unitTotals(rows.map((x) => ({ unit: x.unit, qty: x.plan })));
  return {
    title: "Bajarilish", subtitle: period(r),
    fields: units.length ? units.map((u) => {
      const fact = sumBy(rows.filter((x) => (x.unit || "m3") === u.unit), (x) => x.fact);
      const pct = u.qty > 0 ? (fact / u.qty) * 100 : null;
      return f(`${unitLabel(u.unit)}: fakt / reja`, `${inUnit(fact, u.unit)} / ${inUnit(u.qty, u.unit)} · ${pctText(pct)}`, pct == null ? undefined : pct >= 90 ? "success" : pct >= 60 ? "warning" : "danger");
    }) : [f("Reja", "belgilanmagan"), f("Fakt", totalsText(rows.map((x) => ({ unit: x.unit, qty: x.fact }))))],
    sections: [sec("Mahsulot bo'yicha", rows.map((x, i) => {
      const pct = x.plan > 0 ? (x.fact / x.plan) * 100 : null;
      return { id: `p${i}`, title: x.product, subtitle: `fakt ${inUnit(x.fact, x.unit)}${x.plan ? ` · reja ${inUnit(x.plan, x.unit)}` : ""}`, right: pctText(pct), tone: pct == null ? "info" : pct >= 90 ? "success" : pct >= 60 ? "warning" : "danger" };
    }), { icon: "package", empty: "Bu davrda reja ham, fakt ham yo'q" })],
  };
}

async function defects(r: DashRange, ids: string[] | null): Promise<Part> {
  const rows = await db.productDefect.findMany({
    where: { ...brigadeWhere(ids), date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" },
    select: { id: true, date: true, qty: true, reason: true, note: true, product: { select: { name: true, unit: true } }, brigade: { select: { name: true } }, createdBy: { select: { fullName: true } } },
  });
  const u = (x: (typeof rows)[number]) => ({ qty: x.qty, unit: x.product.unit });
  return {
    title: "Brak", subtitle: period(r),
    fields: [f("Jami", totalsText(rows.map(u))), f("Qaydlar", cnt(rows.length, "ta")), f("Mahsulot turlari", String(new Set(rows.map((x) => x.product.name)).size))],
    sections: pick(
      sec("Mahsulot bo'yicha", groupBy(rows, (x) => x.product.name).map(([name, list], i) => ({ id: `p${i}`, title: name, subtitle: cnt(list.length, "qayd"), right: totalsText(list.map(u)) })), { icon: "package" }),
      breakdown("Sabab bo'yicha", rows, (x) => x.reason, () => 1, (v) => cnt(v, "qayd"), { icon: "triangle-alert" }),
      (!ids || ids.length > 1) && breakdown("Brigadalar bo'yicha", rows, (x) => x.brigade?.name ?? "Brigadasiz", () => 1, (v) => cnt(v, "qayd"), { icon: "hard-hat" }),
      sec("Qaydlar", rows.slice(0, 50).map((x) => ({ id: x.id, title: `${x.product.name} · ${inUnit(sum(x.qty), x.product.unit)}`, subtitle: [dt(x.date), x.reason, x.brigade?.name, x.createdBy.fullName, x.note].filter(Boolean).join(" · "), tone: "warning" })), { icon: "triangle-alert", empty: "Bu davrda brak qayd qilinmagan" }),
    ),
  };
}

async function brigadierIssues(r: DashRange, ids: string[]): Promise<Part> {
  const [open, inPeriod] = await Promise.all([
    db.brigadeIssue.findMany({ where: { brigadeId: { in: ids }, resolvedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, note: true, downtimeMin: true, createdAt: true, equipment: true, task: { select: { taskNo: true } } } }),
    db.brigadeIssue.findMany({ where: { brigadeId: { in: ids }, createdAt: { gte: r.from, lt: r.to } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, note: true, downtimeMin: true, createdAt: true, resolvedAt: true, equipment: true, task: { select: { taskNo: true } } } }),
  ]);
  const row = (x: (typeof inPeriod)[number] | (typeof open)[number]): HomeRow => ({
    id: x.id, title: `${BRIGADE_ISSUE[x.kind].label}${x.task ? ` · ${x.task.taskNo}` : ""}`,
    subtitle: [dt(x.createdAt), x.equipment, x.note, x.downtimeMin ? `to'xtash ${x.downtimeMin} daq` : null].filter(Boolean).join(" · "),
    status: "resolvedAt" in x && x.resolvedAt ? "Hal qilindi" : "Ochiq", tone: "resolvedAt" in x && x.resolvedAt ? "success" : "danger",
  });
  const downtime = sumBy(inPeriod, (x) => x.downtimeMin ?? 0);
  return {
    title: "Muammolar", subtitle: period(r),
    fields: [f("Hozir ochiq", String(open.length), open.length ? "danger" : "success"), f("Davrda qayd qilingan", String(inPeriod.length)), f("Hal qilingan", String(inPeriod.filter((x) => x.resolvedAt).length), "success"), f("To'xtash vaqti (davr)", downtime ? `${downtime} daq` : "—")],
    sections: pick(
      sec("Ochiq muammolar", open.map(row), { target: "brig-issue", empty: "Ochiq muammo yo'q" }),
      breakdown("Tur bo'yicha (davr)", inPeriod, (x) => BRIGADE_ISSUE[x.kind].label, () => 1, (v) => cnt(v, "ta"), { icon: "triangle-alert" }),
      sec("Davrdagi muammolar", inPeriod.filter((x) => x.resolvedAt).slice(0, 40).map(row), { target: "brig-issue", empty: "Hal qilingan muammo yo'q" }),
    ),
  };
}

// ───────────────────────── Logistika / haydovchi ─────────────────────────

const TRIP_SELECT = { id: true, deliveryNoteNo: true, qtyM3: true, status: true, createdAt: true, plannedAt: true, loadedAt: true, departedAt: true, deliveredAt: true, driver: { select: { id: true, fullName: true } }, vehicle: { select: { plate: true } }, order: { select: { distanceKm: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } } } as const;
type TripRow = { id: string; deliveryNoteNo: string; qtyM3: unknown; status: string; createdAt: Date; plannedAt: Date | null; loadedAt: Date | null; departedAt: Date | null; deliveredAt: Date | null; driver: { id: string; fullName: string }; vehicle: { plate: string }; order: { distanceKm: unknown; customer: { name: string }; items: { qtyM3: unknown; product: { unit: string } }[] } };
const tripUnit = (t: TripRow) => t.order.items[0]?.product.unit ?? "m3";
const tripMinutes = (t: TripRow) => (t.deliveredAt ? (t.deliveredAt.getTime() - (t.departedAt ?? t.loadedAt ?? t.createdAt).getTime()) / 60_000 : null);
const tripLateMin = (t: TripRow) => (t.plannedAt && t.deliveredAt ? Math.round((t.deliveredAt.getTime() - t.plannedAt.getTime()) / 60_000) : 0);
const tripRow = (t: TripRow, o: { right?: string; withDriver?: boolean } = {}): HomeRow => ({
  id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`,
  subtitle: [dt(t.deliveredAt ?? t.loadedAt ?? t.createdAt), o.withDriver === false ? null : t.driver.fullName, t.vehicle.plate].filter(Boolean).join(" · "),
  right: o.right ?? tripQty(t as never), status: TRIP_LABEL[t.status] ?? t.status, tone: TRIP_TONE[t.status],
});
const tripsQty = (list: TripRow[]) => totalsText(list.map((t) => ({ unit: tripUnit(t), qty: sum(t.qtyM3) })));

async function deliveredTrips(r: DashRange, driverId: string | null, title = "Yetkazilgan reyslar"): Promise<Part> {
  const [rows, prev] = await Promise.all([
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to }, ...(driverId ? { driverId } : {}) }, orderBy: { deliveredAt: "desc" }, select: TRIP_SELECT }),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.prevFrom, lt: r.prevTo }, ...(driverId ? { driverId } : {}) }, select: { qtyM3: true } }),
  ]);
  const qty = sumBy(rows, (t) => sum(t.qtyM3)), prevQty = sumBy(prev, (t) => sum(t.qtyM3));
  const mins = rows.map(tripMinutes).filter((m): m is number => m != null && m > 0);
  const late = rows.filter((t) => tripLateMin(t) > 15).length;
  return {
    title, subtitle: period(r),
    fields: [
      f("Reyslar", cnt(rows.length, "ta")), f("Hajm", tripsQty(rows)),
      f("O'rtacha yetkazish", mins.length ? `${Math.round(sumBy(mins, (m) => m) / mins.length)} daq` : "—"),
      f("Kechikkan (>15 daq)", `${late} · ${share(late, rows.length)}`, late ? "danger" : "success"),
      prevField(qty, prevQty, r, (v) => inUnit(v, rows[0] ? tripUnit(rows[0]) : "m3")),
    ],
    sections: pick(
      !driverId && breakdown("Haydovchilar bo'yicha", rows, (t) => t.driver.fullName, () => 1, (v) => cnt(v, "reys"), { icon: "id-card", unitWord: "reys", target: "employees", id: (l) => l[0]!.driver.id }),
      breakdown("Mijozlar bo'yicha", rows, (t) => t.order.customer.name, (t) => sum(t.qtyM3), (v) => inUnit(v, rows[0] ? tripUnit(rows[0]) : "m3"), { icon: "users", unitWord: "reys" }),
      breakdown("Transport bo'yicha", rows, (t) => t.vehicle.plate, () => 1, (v) => cnt(v, "reys"), { icon: "truck", unitWord: "reys" }),
      byDays(r, rows, (t) => t.deliveredAt!, tripsQty, (l) => cnt(l.length, "reys")),
      sec("Reyslar", rows.slice(0, 50).map((t) => tripRow(t, { withDriver: !driverId })), { target: "trips", empty: "Bu davrda yetkazilgan reys yo'q" }),
    ),
  };
}

async function createdTrips(r: DashRange, driverId: string | null): Promise<Part> {
  const rows = await db.trip.findMany({ where: { createdAt: { gte: r.from, lt: r.to }, ...(driverId ? { driverId } : {}) }, orderBy: { createdAt: "desc" }, select: TRIP_SELECT });
  const by = (s: string) => rows.filter((t) => t.status === s).length;
  return {
    title: driverId ? "Mening reyslarim" : "Ochilgan reyslar", subtitle: period(r),
    fields: [f("Jami", cnt(rows.length, "ta")), f("Yetkazildi", String(by("DELIVERED")), "success"), f("Yo'lda / yuklangan", String(by("ON_ROAD") + by("LOADED")), "brand"), f("Rejada", String(by("PLANNED"))), f("Bekor qilindi", String(by("CANCELLED")), by("CANCELLED") ? "danger" : undefined)],
    sections: pick(
      breakdown("Holat bo'yicha", rows, (t) => TRIP_LABEL[t.status] ?? t.status, () => 1, (v) => cnt(v, "reys"), { icon: "route", unitWord: "reys" }),
      !driverId && breakdown("Haydovchilar bo'yicha", rows, (t) => t.driver.fullName, () => 1, (v) => cnt(v, "reys"), { icon: "id-card", unitWord: "reys", target: "employees", id: (l) => l[0]!.driver.id }),
      byDays(r, rows, (t) => t.createdAt, (l) => cnt(l.length, "reys"), tripsQty),
      sec("Reyslar", rows.slice(0, 50).map((t) => tripRow(t, { withDriver: !driverId })), { target: "trips", empty: "Bu davrda reys ochilmagan" }),
    ),
  };
}

async function tripDurations({ r }: Ctx): Promise<Part> {
  const rows = (await db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: TRIP_SELECT }))
    .map((t) => ({ t: t as TripRow, min: tripMinutes(t) ?? 0 })).filter((x) => x.min > 0).sort((a, b) => b.min - a.min);
  const avg = rows.length ? sumBy(rows, (x) => x.min) / rows.length : null;
  const byDriver = groupBy(rows, (x) => x.t.driver.fullName).map(([name, list]) => ({ name, list, avg: sumBy(list, (x) => x.min) / list.length })).sort((a, b) => b.avg - a.avg);
  return {
    title: "Yetkazish vaqti", subtitle: period(r),
    fields: [f("O'rtacha", avg == null ? "—" : `${Math.round(avg)} daq`), f("Eng tez", rows.length ? `${Math.round(rows[rows.length - 1]!.min)} daq` : "—", "success"), f("Eng uzoq", rows.length ? `${Math.round(rows[0]!.min)} daq` : "—", "warning"), f("2 soatdan uzoq", String(rows.filter((x) => x.min > 120).length))],
    sections: [
      sec("Haydovchilar bo'yicha (o'rtacha)", byDriver.map((g, i) => ({ id: `dr${i}`, title: g.name, subtitle: cnt(g.list.length, "reys"), right: `${Math.round(g.avg)} daq`, tone: g.avg > 120 ? "warning" : "success" })), { icon: "id-card" }),
      sec("Reyslar (uzoqdan tezga)", rows.slice(0, 50).map((x) => tripRow(x.t, { right: `${Math.round(x.min)} daq` })), { target: "trips", empty: "Bu davrda yetkazilgan reys yo'q" }),
    ],
  };
}

async function lateTrips({ r }: Ctx): Promise<Part> {
  const all = await db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: TRIP_SELECT });
  const rows = all.map((t) => ({ t, late: tripLateMin(t) })).filter((x) => x.late > 15).sort((a, b) => b.late - a.late);
  return {
    title: "Kechikkan reyslar", subtitle: `${period(r)} · rejadan 15 daqiqadan ko'p kech`,
    fields: [f("Kechikkan", `${rows.length} / ${all.length} · ${share(rows.length, all.length)}`, rows.length ? "danger" : "success"), f("O'rtacha kechikish", rows.length ? `${Math.round(sumBy(rows, (x) => x.late) / rows.length)} daq` : "—"), f("Eng katta kechikish", rows.length ? `${rows[0]!.late} daq` : "—")],
    sections: pick(
      breakdown("Haydovchilar bo'yicha", rows, (x) => x.t.driver.fullName, () => 1, (v) => cnt(v, "reys"), { icon: "id-card", unitWord: "reys", target: "employees", id: (l) => l[0]!.t.driver.id }),
      sec("Reyslar", rows.slice(0, 50).map((x) => tripRow(x.t, { right: `+${x.late} daq` })), { target: "trips", empty: "Kechikkan reys yo'q" }),
    ),
  };
}

async function fuelLogs(r: DashRange, driverId: string | null): Promise<Part> {
  const rows = await db.fuelLog.findMany({
    where: { date: { gte: r.from, lt: r.to }, ...(driverId ? { driverId } : {}) }, orderBy: { date: "desc" },
    select: { id: true, date: true, liters: true, amount: true, pricePerL: true, fuelType: true, station: true, vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, trip: { select: { deliveryNoteNo: true } } },
  });
  const amount = sumBy(rows, (x) => sum(x.amount)), liters = sumBy(rows, (x) => sum(x.liters));
  return {
    title: "Yoqilg'i", subtitle: period(r),
    fields: [f("Jami summa", money(amount)), f("Litr", `${num(liters)} l`), f("O'rtacha narx", liters ? `${money(amount / liters)} / l` : "—"), f("Yozuvlar", cnt(rows.length, "ta"))],
    sections: pick(
      breakdown("Transport bo'yicha", rows, (x) => x.vehicle.plate, (x) => sum(x.amount), short, { icon: "truck", unitWord: "yozuv" }),
      !driverId && breakdown("Haydovchilar bo'yicha", rows, (x) => x.driver?.fullName ?? "—", (x) => sum(x.amount), short, { icon: "id-card", unitWord: "yozuv" }),
      breakdown("Yoqilg'i turi", rows, (x) => FUEL_TYPE[x.fuelType], (x) => sum(x.liters), (v) => `${num(v)} l`, { icon: "droplets", unitWord: "yozuv" }),
      byDays(r, rows, (x) => x.date, (l) => short(sumBy(l, (x) => sum(x.amount))), (l) => `${num(sumBy(l, (x) => sum(x.liters)))} l`),
      sec("Yozuvlar", rows.slice(0, 50).map((x) => ({ id: x.id, title: `${x.vehicle.plate} · ${num(sum(x.liters))} l ${FUEL_TYPE[x.fuelType]}`, subtitle: [day(x.date), x.driver?.fullName, x.station, x.trip?.deliveryNoteNo].filter(Boolean).join(" · "), right: short(sum(x.amount)) })), { icon: "droplets", empty: "Bu davrda yoqilg'i quyilmagan" }),
    ),
  };
}

async function transportCosts({ r }: Ctx): Promise<Part> {
  const rows = await db.transportExpense.findMany({
    where: { date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" },
    select: { id: true, date: true, kind: true, amount: true, note: true, vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, trip: { select: { deliveryNoteNo: true } } },
  });
  const total = sumBy(rows, (x) => sum(x.amount));
  return {
    title: "Transport xarajati", subtitle: period(r),
    fields: [f("Jami", money(total)), f("Yozuvlar", cnt(rows.length, "ta")), f("Eng katta tur", rows.length ? groupBy(rows, (x) => EXPENSE_KIND[x.kind]).map(([k, l]) => ({ k, v: sumBy(l, (x) => sum(x.amount)) })).sort((a, b) => b.v - a.v)[0]!.k : "—")],
    sections: pick(
      breakdown("Tur bo'yicha", rows, (x) => EXPENSE_KIND[x.kind], (x) => sum(x.amount), short, { icon: "wallet", unitWord: "yozuv" }),
      breakdown("Transport bo'yicha", rows, (x) => x.vehicle?.plate ?? "Umumiy", (x) => sum(x.amount), short, { icon: "truck", unitWord: "yozuv" }),
      byDays(r, rows, (x) => x.date, (l) => short(sumBy(l, (x) => sum(x.amount)))),
      sec("Yozuvlar", rows.slice(0, 50).map((x) => ({ id: x.id, title: `${EXPENSE_KIND[x.kind]}${x.vehicle ? ` · ${x.vehicle.plate}` : ""}`, subtitle: [day(x.date), x.driver?.fullName, x.trip?.deliveryNoteNo, x.note].filter(Boolean).join(" · "), right: short(sum(x.amount)) })), { icon: "wallet", empty: "Bu davrda xarajat yo'q" }),
    ),
  };
}

async function tripIssues(r: DashRange, driverId: string | null): Promise<Part> {
  const rows = await db.tripIssue.findMany({
    where: { createdAt: { gte: r.from, lt: r.to }, ...(driverId ? { trip: { driverId } } : {}) }, orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, note: true, createdAt: true, resolvedAt: true, resolution: true, trip: { select: { id: true, deliveryNoteNo: true, driver: { select: { fullName: true } }, order: { select: { customer: { select: { name: true } } } } } } },
  });
  const open = rows.filter((x) => !x.resolvedAt);
  const byTrip = groupBy(rows, (x) => x.trip.id);
  return {
    title: "Reys muammolari", subtitle: period(r),
    fields: [f("Jami", cnt(rows.length, "ta")), f("Ochiq", String(open.length), open.length ? "danger" : "success"), f("Hal qilingan", String(rows.length - open.length), "success"), f("Reyslar", cnt(byTrip.length, "ta"))],
    sections: pick(
      breakdown("Tur bo'yicha", rows, (x) => ISSUE_KIND[x.kind] ?? x.kind, () => 1, (v) => cnt(v, "ta"), { icon: "triangle-alert" }),
      !driverId && breakdown("Haydovchilar bo'yicha", rows, (x) => x.trip.driver.fullName, () => 1, (v) => cnt(v, "ta"), { icon: "id-card" }),
      sec("Reyslar bo'yicha", byTrip.slice(0, 50).map(([id, list]) => ({
        id, title: `${list[0]!.trip.deliveryNoteNo} · ${list[0]!.trip.order.customer.name}`,
        subtitle: list.map((x) => `${ISSUE_KIND[x.kind] ?? x.kind}${x.note ? ` (${x.note})` : ""}`).join(" · "),
        right: dt(list[0]!.createdAt), status: list.some((x) => !x.resolvedAt) ? "Ochiq" : "Hal qilindi", tone: list.some((x) => !x.resolvedAt) ? "danger" : "success",
      })), { target: "trips", empty: "Bu davrda muammo qayd qilinmagan" }),
    ),
  };
}

async function driverKm({ user, r }: Ctx): Promise<Part> {
  const me = await driverEmployeeId(user.id);
  const rows = await db.trip.findMany({ where: { driverId: me, status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, orderBy: { deliveredAt: "desc" }, select: TRIP_SELECT });
  const km = (t: TripRow) => sum(t.order.distanceKm) * 2;
  const total = sumBy(rows, km);
  return {
    title: "Yo'l (taxminan)", subtitle: `${period(r)} · zavod → obyekt → zavod`,
    fields: [f("Jami", `${Math.round(total)} km`), f("Reyslar", cnt(rows.length, "ta")), f("O'rtacha reys", rows.length ? `${Math.round(total / rows.length)} km` : "—"), f("Masofasi noma'lum", String(rows.filter((t) => !sum(t.order.distanceKm)).length))],
    sections: pick(
      breakdown("Mijozlar bo'yicha", rows, (t) => t.order.customer.name, km, (v) => `${Math.round(v)} km`, { icon: "users", unitWord: "reys" }),
      byDays(r, rows, (t) => t.deliveredAt!, (l) => `${Math.round(sumBy(l, km))} km`, (l) => cnt(l.length, "reys")),
      sec("Reyslar", rows.slice(0, 50).map((t) => tripRow(t, { right: sum(t.order.distanceKm) ? `${Math.round(km(t))} km` : "—", withDriver: false })), { target: "trips", empty: "Bu davrda reys yo'q" }),
    ),
  };
}

// ───────────────────────── Sklad / snabjeniye ─────────────────────────

async function goodsReceipts(r: DashRange, title: string): Promise<Part> {
  const [rows, prev] = await Promise.all([
    db.goodsReceipt.findMany({ where: { cancelledAt: null, date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" }, select: { id: true, docNo: true, date: true, supplier: { select: { id: true, name: true } }, createdBy: { select: { fullName: true } }, items: { select: { qty: true, price: true, material: { select: { id: true, name: true, unit: true } } } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { cancelledAt: null, date: { gte: r.prevFrom, lt: r.prevTo } } }, select: { qty: true, price: true } }),
  ]);
  const amt = (x: (typeof rows)[number]) => sumBy(x.items, (i) => sum(i.qty) * sum(i.price));
  const amount = sumBy(rows, amt), prevAmount = sumBy(prev, (i) => sum(i.qty) * sum(i.price));
  const items = rows.flatMap((x) => x.items);
  return {
    title, subtitle: period(r),
    fields: [f("Jami summa", money(amount)), f("Hujjatlar", cnt(rows.length, "ta")), f("Yetkazuvchilar", cnt(new Set(rows.map((x) => x.supplier.id)).size, "ta")), f("Material turlari", String(new Set(items.map((i) => i.material.id)).size)), prevField(amount, prevAmount, r)],
    sections: pick(
      breakdown("Yetkazuvchilar bo'yicha", rows, (x) => x.supplier.name, amt, short, { icon: "store", unitWord: "hujjat", target: "suppliers", id: (l) => l[0]!.supplier.id }),
      sec("Materiallar bo'yicha", groupBy(items, (i) => i.material.id).map(([id, list]) => ({ id, list, v: sumBy(list, (i) => sum(i.qty) * sum(i.price)) })).sort((a, b) => b.v - a.v).slice(0, 15)
        .map((g) => ({ id: g.id, title: g.list[0]!.material.name, subtitle: `${inUnit(sumBy(g.list, (i) => sum(i.qty)), g.list[0]!.material.unit)} · ${share(g.v, amount)}`, right: short(g.v) })), { icon: "layers", target: "stock" }),
      byDays(r, rows, (x) => x.date, (l) => short(sumBy(l, amt)), (l) => cnt(l.length, "hujjat")),
      sec("Hujjatlar", rows.slice(0, 50).map((x) => ({ id: x.id, title: `${x.docNo} · ${x.supplier.name}`, subtitle: `${day(x.date)} · ${x.items.slice(0, 3).map((i) => i.material.name).join(", ")}${x.items.length > 3 ? ` +${x.items.length - 3}` : ""}`, right: short(amt(x)) })), { target: "receipts", empty: "Bu davrda kirim yo'q" }),
    ),
  };
}

async function lowStock(r?: DashRange): Promise<Part> {
  // Davr tanlangan bo'lsa — davr oxiridagi qoldiq (o'tgan davrda qanday edi; joriy davrda = hozir)
  const at = r && r.to < new Date() ? r.to : null;
  const [materials, balances] = await Promise.all([
    db.material.findMany({ where: { isActive: true, minStock: { gt: 0 } }, select: { id: true, name: true, unit: true, minStock: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null }, ...(at ? { date: { lt: at } } : {}) }, _sum: { qty: true } }),
  ]);
  const bal = new Map(balances.map((b) => [b.materialId, sum(b._sum.qty)]));
  const rows = materials.map((m) => ({ m, balance: bal.get(m.id) ?? 0, min: sum(m.minStock) })).map((x) => ({ ...x, pct: x.min > 0 ? (x.balance / x.min) * 100 : null })).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
  const low = rows.filter((x) => (x.pct ?? 0) < 100);
  const row = (x: (typeof rows)[number]): HomeRow => ({ id: x.m.id, title: x.m.name, subtitle: `qoldiq ${inUnit(x.balance, x.m.unit)} · minimum ${inUnit(x.min, x.m.unit)}${x.balance < x.min ? ` · kerak ${inUnit(x.min - x.balance, x.m.unit)}` : ""}`, right: pctText(x.pct), tone: (x.pct ?? 0) < 100 ? "danger" : (x.pct ?? 0) < 150 ? "warning" : "success" });
  return {
    title: "Kam qolgan xomashyo", subtitle: at ? `${period(r!)} oxiridagi qoldiq / minimum` : "Hozirgi qoldiq / minimum",
    fields: [f("Minimumdan past", String(low.length), low.length ? "danger" : "success"), f("Nazoratda", cnt(materials.length, "xomashyo")), f("Zaxira yaqin (100–150%)", String(rows.filter((x) => (x.pct ?? 0) >= 100 && (x.pct ?? 0) < 150).length))],
    sections: [
      sec("Kam qolganlar", low.map(row), { target: "stock", empty: "Hammasi yetarli" }),
      sec("Qolganlari", rows.filter((x) => (x.pct ?? 0) >= 100).map(row), { target: "stock", empty: "—" }),
    ],
  };
}

const MOVE_SELECT = { id: true, date: true, type: true, qty: true, note: true, createdBy: { select: { fullName: true } }, material: { select: { id: true, name: true, unit: true } }, product: { select: { name: true, unit: true } }, brigade: { select: { name: true } } } as const;
type MoveRow = { id: string; date: Date; type: string; qty: unknown; note: string | null; createdBy: { fullName: string }; material: { id: string; name: string; unit: string } | null; product: { name: string; unit: string } | null; brigade: { name: string } | null };
const moveName = (m: MoveRow) => m.material?.name ?? m.product?.name ?? "—";
const moveUnit = (m: MoveRow) => m.material?.unit ?? m.product?.unit ?? "";
const moveRow = (m: MoveRow): HomeRow => ({ id: m.id, title: `${MOVE_LABEL[m.type] ?? m.type} · ${moveName(m)}`, subtitle: [dt(m.date), m.brigade?.name, m.createdBy.fullName, m.note].filter(Boolean).join(" · "), right: `${sum(m.qty) > 0 ? "+" : ""}${inUnit(sum(m.qty), moveUnit(m))}`, tone: sum(m.qty) < 0 ? "warning" : "success" });
/** Materiallar bo'yicha bo'lim — qator bosilsa xomashyo kartochkasi. */
const movesByMaterial = (title: string, moves: MoveRow[], abs = true) =>
  sec(title, groupBy(moves.filter((m) => m.material), (m) => m.material!.id).map(([id, list]) => ({ id, list, v: sumBy(list, (m) => (abs ? Math.abs(sum(m.qty)) : sum(m.qty))) })).sort((a, b) => b.v - a.v).slice(0, 20)
    .map((g) => ({ id: g.id, title: g.list[0]!.material!.name, subtitle: cnt(g.list.length, "harakat"), right: inUnit(g.v, g.list[0]!.material!.unit) })), { icon: "layers", target: "stock" });

async function stockMoves(r: DashRange, types: string[], title: string, sub: string): Promise<Part> {
  const moves = await db.stockMove.findMany({ where: { date: { gte: r.from, lt: r.to }, type: { in: types as never } }, orderBy: { date: "desc" }, select: MOVE_SELECT });
  const isBrigade = types.includes("BRIGADE_ISSUE");
  const issued = moves.filter((m) => m.type === "BRIGADE_ISSUE"), returned = moves.filter((m) => m.type === "BRIGADE_RETURN");
  return {
    title, subtitle: `${period(r)} · ${sub}`,
    fields: isBrigade
      ? [f("Berildi", cnt(issued.length, "harakat")), f("Qaytdi", cnt(returned.length, "harakat")), f("Brigadalar", cnt(new Set(moves.map((m) => m.brigade?.name).filter(Boolean)).size, "ta"))]
      : [f("Harakatlar", cnt(moves.length, "ta")), f("Material turlari", String(new Set(moves.map(moveName)).size)), ...(types.includes("ADJUSTMENT") ? [f("Kamomad (−)", cnt(moves.filter((m) => sum(m.qty) < 0).length, "yozuv"), moves.some((m) => sum(m.qty) < 0) ? "warning" : undefined), f("Ortiqcha (+)", cnt(moves.filter((m) => sum(m.qty) > 0).length, "yozuv"))] : [])],
    sections: pick(
      isBrigade && breakdown("Brigadalar bo'yicha", moves, (m) => m.brigade?.name ?? "—", () => 1, (v) => cnt(v, "harakat"), { icon: "hard-hat" }),
      movesByMaterial("Materiallar bo'yicha", moves),
      byDays(r, moves, (m) => m.date, (l) => cnt(l.length, "harakat")),
      sec("Harakatlar", moves.slice(0, 60).map(moveRow), { icon: "arrow-up-down", empty: "Bu davrda harakat yo'q" }),
    ),
  };
}

type ProcRow = Awaited<ReturnType<typeof procurementHome>>["urgent"][number];
const procRow = (x: ProcRow): HomeRow => ({
  id: x.id, title: `${x.docNo} · ${x.department}`,
  subtitle: [x.what, x.qtyText, x.supplier, x.needBy ? `kerak ${day(x.needBy)}` : null, x.waitDirector ? "direktor tasdig'ida" : null, x.late > 0 ? `${x.late} kun kech` : null].filter(Boolean).join(" · "),
  right: x.total ? short(x.total) : PRIORITY_LABEL[x.priority], status: x.delivery && x.status === "FUNDED" ? DELIVERY_LABEL[x.delivery] : SUPPLY_LABEL[x.status],
  tone: x.late > 0 || x.priority === "CRITICAL" ? "danger" : x.priority === "HIGH" ? "warning" : SUPPLY_TONE[x.status],
});
const procTotals = (rows: ProcRow[]) => sumBy(rows, (x) => x.total);

async function procOpen(r?: DashRange): Promise<Part> {
  const home = await procurementHome(r ? procRange(r) : {});
  const rows = [...home.urgent, ...home.deliveries, ...home.delayed];
  // Hamma ochiq hujjat: `procurementHome` ularni holat bo'yicha ajratib beradi — bir ro'yxatga yig'amiz
  const all = await db.supplyRequest.findMany({ where: { status: { in: ["NEW", "PRICED", "APPROVED", "FUNDED"] }, ...(r ? { date: { gte: r.from, lt: r.to } } : {}) }, orderBy: [{ needBy: "asc" }, { date: "asc" }], select: { id: true } });
  const byId = new Map(rows.map((x) => [x.id, x]));
  const c = home.counts;
  const byStatus = (s: string) => rows.filter((x) => x.status === s);
  const list = all.map((x) => byId.get(x.id)).filter((x): x is ProcRow => !!x);
  const missing = all.length - list.length;
  return {
    title: "Ochiq talablar", subtitle: r ? `${period(r)} ochilgan · hozirgi holati` : "Hozirgi holat",
    fields: [
      f("Jami ochiq", cnt(c.open, "ta")), f("Narx kutmoqda", String(c.priceWait), c.priceWait ? "warning" : undefined), f("Tasdiqda", String(c.approveWait), c.approveWait ? "warning" : undefined),
      f("Xaridda (buyurtma)", String(c.orders), "brand"), f("Kechikkan", String(c.delayed), c.delayed ? "danger" : "success"), f("Ochiq summa", money(home.money.pipeline + home.money.ordered)),
    ],
    sections: pick(
      sec("Holat bo'yicha", ["NEW", "PRICED", "APPROVED", "FUNDED"].map((s, i) => ({ id: `s${i}`, title: SUPPLY_LABEL[s as never], subtitle: cnt(byStatus(s).length, "hujjat"), right: short(procTotals(byStatus(s))), tone: SUPPLY_TONE[s] })), { icon: "clipboard-list" }),
      sec("Hujjatlar", [...new Map(list.map((x) => [x.id, x])).values()].slice(0, 60).map(procRow), { target: "supply", empty: missing ? `${missing} ta oddiy talab — ro'yxatda` : "Ochiq talab yo'q" }),
    ),
  };
}

async function procList(kind: "urgent" | "orders" | "transit" | "late", r?: DashRange): Promise<Part> {
  const home = await procurementHome(r ? procRange(r) : {});
  const rows = kind === "urgent" ? home.urgent : kind === "orders" ? home.deliveries : kind === "transit" ? home.deliveries.filter((x) => x.delivery === "IN_TRANSIT") : home.delayed;
  const title = { urgent: "Shoshilinch talablar", orders: "Buyurtmalar (xaridda)", transit: "Yo'ldagi yuklar", late: "Kechikkanlar" }[kind];
  return {
    title, subtitle: "Hozirgi holat",
    fields: [
      f("Jami", cnt(rows.length, "ta")), f("Summa", money(procTotals(rows))),
      ...(kind === "urgent" ? [f("Kritik", String(rows.filter((x) => x.priority === "CRITICAL").length), rows.some((x) => x.priority === "CRITICAL") ? "danger" : undefined), f("Direktor tasdig'ida", String(rows.filter((x) => x.waitDirector).length))] : []),
      ...(kind === "orders" ? [f("Yo'lda", String(rows.filter((x) => x.delivery === "IN_TRANSIT").length), "brand"), f("Kechikkan", String(rows.filter((x) => x.late > 0).length), rows.some((x) => x.late > 0) ? "danger" : "success")] : []),
      ...(kind === "transit" ? [f("ETA bugun", String(rows.filter((x) => x.eta && daysBetween(today0(), x.eta) === 0).length))] : []),
      ...(kind === "late" && rows.length ? [f("Eng ko'p kechikish", cnt(Math.max(...rows.map((x) => x.late)), "kun"), "danger")] : []),
    ],
    sections: pick(
      breakdown("Yetkazuvchilar bo'yicha", rows, (x) => x.supplier ?? "Yetkazuvchi tanlanmagan", (x) => x.total, short, { icon: "store", unitWord: "hujjat" }),
      kind !== "transit" && breakdown("Bo'limlar bo'yicha", rows, (x) => x.department, () => 1, (v) => cnt(v, "ta"), { icon: "building" }),
      sec("Hujjatlar", rows.slice(0, 60).map(procRow), { target: "supply", empty: { urgent: "Shoshilinch talab yo'q", orders: "Ochiq buyurtma yo'q", transit: "Yo'lda yuk yo'q", late: "Kechikkan yuk yo'q" }[kind] }),
    ),
  };
}

async function procAvgDays({ r }: Ctx): Promise<Part> {
  const rows = (await db.supplyRequest.findMany({ where: { createdAt: { gte: r.from, lt: r.to }, receipt: { isNot: null } }, select: { id: true, docNo: true, createdAt: true, department: true, supplier: { select: { name: true } }, warehouse: { select: { name: true } }, receipt: { select: { date: true } }, items: { select: { name: true } } } }))
    .map((x) => ({ x, days: (x.receipt!.date.getTime() - x.createdAt.getTime()) / 86_400_000 })).sort((a, b) => b.days - a.days);
  const avg = rows.length ? sumBy(rows, (x) => x.days) / rows.length : null;
  return {
    title: "Yetkazish muddati", subtitle: `${period(r)} · so'rovdan kirimgacha`,
    fields: [f("O'rtacha", avg == null ? "—" : `${avg.toFixed(1)} kun`), f("Hujjatlar", cnt(rows.length, "ta")), f("Eng uzoq", rows.length ? `${rows[0]!.days.toFixed(1)} kun` : "—", "warning"), f("5 kundan uzoq", String(rows.filter((x) => x.days > 5).length))],
    sections: pick(
      breakdown("Yetkazuvchilar bo'yicha (o'rtacha)", rows, (x) => x.x.supplier?.name ?? "—", (x) => x.days, (v) => `${v.toFixed(1)} kun`, { icon: "store", unitWord: "hujjat" }),
      sec("Hujjatlar", rows.slice(0, 50).map(({ x, days }) => ({ id: x.id, title: `${x.docNo} · ${x.department ?? x.warehouse.name}`, subtitle: `${day(x.createdAt)} → ${day(x.receipt!.date)} · ${x.items.slice(0, 2).map((i) => i.name).join(", ")}`, right: `${days.toFixed(1)} kun`, tone: days > 5 ? "warning" : "success" })), { target: "supply", empty: "Bu davrda qabul qilingan so'rov yo'q" }),
    ),
  };
}

// ───────────────────────── Mexanik (Sklad & Logistika) ─────────────────────────

type SlOrderRow = Awaited<ReturnType<typeof skladLogistika>>["orders"][number];
const slOrderRow = (o: SlOrderRow): HomeRow => ({
  id: o.id, title: `${o.orderNo} · ${o.customer}`, subtitle: `${o.time ?? "soatsiz"} · ${o.products}`,
  right: `${num(o.shipped)}/${num(o.total)}${o.unit ? ` ${unitLabel(o.unit)}` : ""}`, status: o.statusLabel, tone: o.blocked || o.problem ? "danger" : o.late ? "warning" : o.done ? "success" : "brand",
});
type SlProductRow = Awaited<ReturnType<typeof skladLogistika>>["products"][number];
const slProductRow = (p: SlProductRow, right: string, tone: Tone): HomeRow => ({ id: p.id, title: `${p.code} · ${p.name}`, subtitle: `bugun ${p.today ? inUnit(p.today, p.unit) : "—"} · ertaga ${p.tomorrow ? inUnit(p.tomorrow, p.unit) : "—"} · skladda ${inUnit(p.onHand, p.unit)}`, right, tone });

/** Mexanik kartalari davr filtri bilan: "bugun/ertaga" — kunda; hafta/oy/yil — shu davr va keyingi teng davr. */
const slFor = (r?: DashRange) => (r && r.key !== "day" ? skladLogistika(undefined, { from: r.from, to: r.to }) : skladLogistika());
const slWords = (r?: DashRange) => (r && r.key !== "day" ? { cur: period(r), next: "keyingi davr", Cur: `Davr (${period(r)})`, Next: "Keyingi davr" } : { cur: "bugun", next: "ertaga", Cur: "Bugun", Next: "Ertaga" });

async function mechToday(kind: "orders" | "shipped" | "left" | "problem", r?: DashRange): Promise<Part> {
  const d = await slFor(r);
  const w = slWords(r);
  const t = d.today;
  const rows = kind === "orders" ? d.orders.filter((o) => !o.late) : kind === "shipped" ? d.orders.filter((o) => o.shipped > 0) : kind === "left" ? d.orders.filter((o) => !o.done) : d.orders.filter((o) => o.problem || o.blocked || o.late);
  const title = { orders: `Zayavkalar (${w.cur})`, shipped: `Jo'natilgan (${w.cur})`, left: "Qolgan zayavkalar", problem: "Muammoli / kechikkan" }[kind];
  return {
    title, subtitle: `${w.Cur} · ${day(d.day)}${r && r.key !== "day" ? ` — ${day(new Date(d.next.getTime() - 1))}` : ""}`,
    fields: [
      f("Zayavkalar", cnt(t.orders, "ta")), f("Hajm", t.volume), f("Jo'natildi", `${t.shipped} ta · ${t.shippedVolume}`, "success"), f("Qoldi", `${t.left} ta · ${t.leftVolume}`, t.left ? "warning" : undefined),
      ...(kind === "orders" || kind === "problem" ? [f("Tasdiqlanmagan", String(t.drafts), t.drafts ? "warning" : undefined), f("Muammoli / kechikkan", String(t.problem), t.problem ? "danger" : "success"), f("Oldingi kunlardan", String(t.overdue), t.overdue ? "danger" : undefined)] : []),
    ],
    sections: [sec("Zayavkalar", rows.map(slOrderRow), { target: "orders", empty: { orders: "Zayavka yo'q", shipped: "Hali jo'natilmadi", left: "Hammasi jo'natildi", problem: "Muammoli zayavka yo'q" }[kind] })],
  };
}

async function mechProducts(kind: "today" | "need" | "stock" | "short", r?: DashRange): Promise<Part> {
  const d = await slFor(r);
  const w = slWords(r);
  const n = d.tomorrow;
  const rows = kind === "today" ? d.products.filter((p) => p.today > 0) : kind === "need" ? d.products.filter((p) => p.tomorrow > 0) : kind === "stock" ? d.products.filter((p) => p.stocked || p.onHand > 0) : d.products.filter((p) => p.balance < -0.001);
  const title = { today: `Zayavka bo'yicha mahsulot (${w.cur})`, need: `${w.Next} kerak bo'ladigan mahsulot`, stock: "Skladda mavjud", short: "Yetishmaydigan mahsulot" }[kind];
  const right = (p: SlProductRow): [string, Tone] =>
    kind === "today" ? [`${inUnit(p.today - p.todayLeft, p.unit)} / ${inUnit(p.today, p.unit)}`, p.todayLeft > 0.001 ? "warning" : "success"]
    : kind === "need" ? [inUnit(p.tomorrow, p.unit), p.balance < -0.001 ? "danger" : "success"]
    : kind === "stock" ? [inUnit(p.forTomorrow, p.unit), p.forTomorrow > 0 ? "info" : "warning"]
    : [inUnit(p.balance, p.unit), "danger"];
  return {
    title, subtitle: kind === "today" ? `${w.Cur} · ${day(d.day)}` : `${w.Next} · ${day(d.next)} dan`,
    fields: kind === "today"
      ? [f("Zayavka bo'yicha", d.today.volume), f("Jo'natildi", d.today.shippedVolume, "success"), f("Qoldi", d.today.leftVolume, d.today.left ? "warning" : undefined)]
      : [f(`${w.Next} kerak`, n.need), f(`Skladda (${w.cur} jo'natishdan keyin)`, n.available), f("Yetishmaydi", n.short, n.shortCount ? "danger" : "success"), f(`${w.Next} zayavkalari`, cnt(n.orders, "ta"))],
    sections: [sec("Mahsulotlar", rows.map((p) => { const [rt, tone] = right(p); return slProductRow(p, rt, tone); }), { icon: "package", empty: { today: "Zayavka yo'q", need: "Keyingi davrda zayavka yo'q", stock: "Skladda tayyor mahsulot yo'q", short: "Hammasi yetarli" }[kind] })],
  };
}

async function mechTomorrow(kind: "orders" | "trucks", r?: DashRange): Promise<Part> {
  const d = await slFor(r);
  const w = slWords(r);
  const n = d.tomorrow;
  // Keyingi davr — joriy davr uzunligida (kunda — ertaga)
  const after = new Date(d.next.getTime() + (d.next.getTime() - d.day.getTime()));
  const orders = await db.order.findMany({
    where: { deliveryDate: { gte: d.next, lt: after }, status: { not: "CANCELLED" } }, orderBy: [{ deliveryTime: "asc" }],
    select: { id: true, orderNo: true, status: true, deliveryTime: true, needsPump: true, needsDelivery: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { name: true, unit: true } } } } },
  });
  const rows: HomeRow[] = orders.map((o) => ({
    id: o.id, title: `${o.orderNo} · ${o.customer.name}`,
    subtitle: [o.deliveryTime ?? "soatsiz", o.items.map((i) => i.product.name).slice(0, 3).join(", "), o.needsPump ? "nasos" : null, o.needsDelivery === false ? "o'zi olib ketadi" : null].filter(Boolean).join(" · "),
    right: totalsText(o.items.map((i) => ({ unit: i.product.unit, qty: sum(i.qtyM3) }))), status: ORDER_LABEL[o.status] ?? o.status, tone: o.status === "DRAFT" ? "warning" : o.status === "BLOCKED" ? "danger" : "brand",
  }));
  const fleet = n.vehicles.mixer + n.vehicles.truck;
  return {
    title: kind === "orders" ? `${w.Next} zayavkalari` : `${w.Next} transport ehtiyoji`, subtitle: `${w.Next} · ${day(d.next)} dan`,
    fields: kind === "orders"
      ? [f("Zayavkalar", cnt(n.orders, "ta")), f("Tasdiqlanmagan", String(n.drafts), n.drafts ? "warning" : undefined), f("Kerak mahsulot", n.need), f("Yetishmaydi", n.short, n.shortCount ? "danger" : "success")]
      : [f("Kerak mashina", `${n.trips} ta`, n.trips > fleet ? "warning" : undefined), f("Mikser / yuk", `${n.mixerTrips} / ${n.truckTrips}`), f("Nasos", String(n.pumps)), f("Saflda", `${fleet} ta (mikser ${n.vehicles.mixer}, yuk ${n.vehicles.truck}, nasos ${n.vehicles.pump})`), f("Ta'mirda", String(n.vehicles.repair), n.vehicles.repair ? "warning" : undefined), f("Reys biriktirilgan", String(n.assigned))],
    sections: [sec("Zayavkalar", rows, { target: "orders", empty: "Zayavka yo'q" })],
  };
}

// ───────────────────────── Pul: buxgalteriya, moliya, kassa ─────────────────────────

const PAY_SELECT = { id: true, date: true, amount: true, note: true, customer: { select: { id: true, name: true } }, cashAccount: { select: { name: true } }, invoice: { select: { invoiceNo: true } } } as const;
type PayRow = { id: string; date: Date; amount: unknown; note: string | null; customer: { id: string; name: string }; cashAccount: { name: string }; invoice: { invoiceNo: string } | null };
const payRow = (p: PayRow): HomeRow => ({ id: p.id, title: p.customer.name, subtitle: [dt(p.date), p.cashAccount.name, p.invoice?.invoiceNo, p.note].filter(Boolean).join(" · "), right: short(sum(p.amount)), tone: "success" });
const paySum = (list: PayRow[]) => sumBy(list, (p) => sum(p.amount));

async function payments(r: DashRange, title: string): Promise<Part> {
  const [rows, prev] = await Promise.all([
    db.payment.findMany({ where: { date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" }, select: PAY_SELECT }),
    db.payment.aggregate({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { amount: true } }),
  ]);
  const total = paySum(rows);
  return {
    title, subtitle: period(r),
    fields: [f("Jami", money(total)), f("To'lovlar", cnt(rows.length, "ta")), f("Mijozlar", cnt(new Set(rows.map((p) => p.customer.id)).size, "ta")), f("O'rtacha to'lov", rows.length ? money(total / rows.length) : "—"), prevField(total, sum(prev._sum.amount), r)],
    sections: pick(
      breakdown("Mijozlar bo'yicha", rows, (p) => p.customer.name, (p) => sum(p.amount), short, { icon: "users", unitWord: "to'lov", target: "customers", id: (l) => l[0]!.customer.id, limit: 15 }),
      breakdown("Hisoblar bo'yicha", rows, (p) => p.cashAccount.name, (p) => sum(p.amount), short, { icon: "landmark", unitWord: "to'lov" }),
      byDays(r, rows, (p) => p.date, (l) => short(paySum(l)), (l) => cnt(l.length, "to'lov")),
      sec("To'lovlar", rows.slice(0, 60).map(payRow), { target: "payments", empty: "Bu davrda to'lov yo'q" }),
    ),
  };
}

const TX_SELECT = { id: true, date: true, amount: true, type: true, category: true, counterparty: true, note: true, cashAccount: { select: { name: true } }, supplier: { select: { name: true } }, createdBy: { select: { fullName: true } } } as const;
type TxRow = { id: string; date: Date; amount: unknown; type: string; category: string; counterparty: string | null; note: string | null; cashAccount: { name: string }; supplier: { name: string } | null; createdBy: { fullName: string } };
const txRow = (t: TxRow): HomeRow => ({ id: t.id, title: `${t.category}${t.supplier || t.counterparty ? ` · ${t.supplier?.name ?? t.counterparty}` : ""}`, subtitle: [dt(t.date), t.cashAccount.name, t.createdBy.fullName, t.note].filter(Boolean).join(" · "), right: short(sum(t.amount)), tone: t.type === "EXPENSE" ? "warning" : "success" });
const txSum = (list: TxRow[]) => sumBy(list, (t) => sum(t.amount));

async function expenses(r: DashRange): Promise<Part> {
  const [rows, prev] = await Promise.all([
    db.cashTransaction.findMany({ where: { type: "EXPENSE", date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" }, select: TX_SELECT }),
    db.cashTransaction.aggregate({ where: { type: "EXPENSE", date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { amount: true } }),
  ]);
  const total = txSum(rows);
  return {
    title: "Chiqim", subtitle: period(r),
    fields: [f("Jami", money(total)), f("Yozuvlar", cnt(rows.length, "ta")), f("Kategoriyalar", String(new Set(rows.map((t) => t.category)).size)), f("Eng katta yozuv", rows.length ? money(Math.max(...rows.map((t) => sum(t.amount)))) : "—"), prevField(total, sum(prev._sum.amount), r)],
    sections: pick(
      breakdown("Kategoriyalar bo'yicha", rows, (t) => t.category, (t) => sum(t.amount), short, { icon: "chart-pie", unitWord: "yozuv" }),
      breakdown("Kontragentlar bo'yicha", rows, (t) => t.supplier?.name ?? t.counterparty ?? "—", (t) => sum(t.amount), short, { icon: "store", unitWord: "yozuv", limit: 10 }),
      breakdown("Hisoblar bo'yicha", rows, (t) => t.cashAccount.name, (t) => sum(t.amount), short, { icon: "landmark", unitWord: "yozuv" }),
      byDays(r, rows, (t) => t.date, (l) => short(txSum(l)), (l) => cnt(l.length, "yozuv")),
      sec("Chiqimlar", rows.slice(0, 60).map(txRow), { target: "cashflow", empty: "Bu davrda chiqim yo'q" }),
    ),
  };
}

async function income(r: DashRange): Promise<Part> {
  const [pay, tx] = await Promise.all([
    db.payment.findMany({ where: { date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" }, select: PAY_SELECT }),
    db.cashTransaction.findMany({ where: { type: "INCOME", date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" }, select: TX_SELECT }),
  ]);
  const p = paySum(pay), o = txSum(tx), total = p + o;
  const flows = [...pay.map((x) => ({ date: x.date, amount: sum(x.amount), account: x.cashAccount.name })), ...tx.map((x) => ({ date: x.date, amount: sum(x.amount), account: x.cashAccount.name }))];
  return {
    title: "Kirim", subtitle: period(r),
    fields: [f("Jami", money(total)), f("Mijoz to'lovlari", `${money(p)} · ${share(p, total)}`, "success"), f("Boshqa tushum", `${money(o)} · ${share(o, total)}`), f("Yozuvlar", cnt(pay.length + tx.length, "ta"))],
    sections: pick(
      breakdown("Hisoblar bo'yicha", flows, (x) => x.account, (x) => x.amount, short, { icon: "landmark", unitWord: "yozuv" }),
      byDays(r, flows, (x) => x.date, (l) => short(sumBy(l, (x) => x.amount)), (l) => cnt(l.length, "yozuv")),
      sec("Mijoz to'lovlari", pay.slice(0, 40).map(payRow), { target: "payments", empty: "To'lov yo'q" }),
      sec("Boshqa tushumlar", tx.slice(0, 40).map(txRow), { target: "cashflow", empty: "Boshqa tushum yo'q" }),
    ),
  };
}

async function netFlow({ r }: Ctx): Promise<Part> {
  const [pay, tx, prevPay, prevTx] = await Promise.all([
    db.payment.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, amount: true, cashAccount: { select: { name: true } } } }),
    // Boshlang'ich qoldiq va hisoblararo o'tkazma — oqim emas
    db.cashTransaction.findMany({ where: { ...FLOW_ONLY, date: { gte: r.from, lt: r.to } }, select: { date: true, amount: true, type: true, category: true, cashAccount: { select: { name: true } } } }),
    db.payment.aggregate({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["type"], where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { amount: true } }),
  ]);
  type Flow = { date: Date; amount: number; dir: "in" | "out"; category: string; account: string };
  const flows: Flow[] = [
    ...pay.map((p) => ({ date: p.date, amount: sum(p.amount), dir: "in" as const, category: "Mijoz to'lovi", account: p.cashAccount.name })),
    ...tx.map((t) => ({ date: t.date, amount: sum(t.amount), dir: t.type === "EXPENSE" ? ("out" as const) : ("in" as const), category: t.category, account: t.cashAccount.name })),
  ];
  const inSum = sumBy(flows.filter((x) => x.dir === "in"), (x) => x.amount), outSum = sumBy(flows.filter((x) => x.dir === "out"), (x) => x.amount);
  const prevIn = sum(prevPay._sum.amount) + sum(prevTx.find((t) => t.type === "INCOME")?._sum.amount), prevOut = sum(prevTx.find((t) => t.type === "EXPENSE")?._sum.amount);
  const net = inSum - outSum, prevNet = prevIn - prevOut;
  const netOf = (l: Flow[]) => sumBy(l, (x) => (x.dir === "in" ? x.amount : -x.amount));
  return {
    title: "Sof pul oqimi", subtitle: period(r),
    fields: [f("Sof oqim", shortSigned(net) === short(Math.abs(net)) ? money(net) : `−${money(-net)}`, net >= 0 ? "success" : "danger"), f("Kirim", money(inSum), "success"), f("Chiqim", money(outSum), "warning"), f(`Oldingi davr (${r.prevName.replace(/dan$/, "")})`, `${prevNet < 0 ? "−" : ""}${money(Math.abs(prevNet))}`)],
    sections: pick(
      byDays(r, flows, (x) => x.date, (l) => `${netOf(l) < 0 ? "−" : "+"}${short(Math.abs(netOf(l)))}`, (l) => `kirim ${short(sumBy(l.filter((x) => x.dir === "in"), (x) => x.amount))} · chiqim ${short(sumBy(l.filter((x) => x.dir === "out"), (x) => x.amount))}`),
      sec("Hisoblar bo'yicha", groupBy(flows, (x) => x.account).map(([name, l], i) => ({ id: `a${i}`, title: name, subtitle: `kirim ${short(sumBy(l.filter((x) => x.dir === "in"), (x) => x.amount))} · chiqim ${short(sumBy(l.filter((x) => x.dir === "out"), (x) => x.amount))}`, right: `${netOf(l) < 0 ? "−" : "+"}${short(Math.abs(netOf(l)))}`, tone: netOf(l) >= 0 ? "success" : "danger" })), { icon: "landmark" }),
      breakdown("Kirim tarkibi", flows.filter((x) => x.dir === "in"), (x) => x.category, (x) => x.amount, short, { icon: "arrow-down-circle", unitWord: "yozuv" }),
      breakdown("Chiqim kategoriyalari", flows.filter((x) => x.dir === "out"), (x) => x.category, (x) => x.amount, short, { icon: "arrow-up-circle", unitWord: "yozuv" }),
    ),
  };
}

async function balances({ r }: Ctx): Promise<Part> {
  const [accounts, pay, tx, perPay, perTx] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true, type: true } }),
    // Qoldiq — davr oxirida (joriy davrda — hozir)
    db.payment.groupBy({ by: ["cashAccountId"], where: asOf(r) ? { date: { lt: r.to } } : {}, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: asOf(r) ? { date: { lt: r.to } } : {}, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { gte: r.from, lt: r.to } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { date: { gte: r.from, lt: r.to } }, _sum: { amount: true } }),
  ]);
  const rows = accounts.map((a) => {
    // Boshlang'ich qoldiq (OPENING) va o'tkazmalar (TRANSFER_IN/OUT) qoldiqqa kiradi, davr kirimi/chiqimiga emas
    const balance = sum(pay.find((p) => p.cashAccountId === a.id)?._sum.amount) + balanceFromGroups(tx, a.id);
    const inP = sum(perPay.find((p) => p.cashAccountId === a.id)?._sum.amount) + sum(perTx.find((t) => t.cashAccountId === a.id && t.type === "INCOME")?._sum.amount);
    const outP = sum(perTx.find((t) => t.cashAccountId === a.id && t.type === "EXPENSE")?._sum.amount);
    // Davrdagi o'tkazmalar sof qoldig'i (+ kirdi / − chiqdi) — alohida ko'rsatiladi
    const trP = balanceFromGroups(perTx.filter((t) => t.type === "TRANSFER_IN" || t.type === "TRANSFER_OUT"), a.id);
    return { a, balance, inP, outP, trP };
  }).sort((a, b) => b.balance - a.balance);
  const total = sumBy(rows, (x) => x.balance);
  const cash = sumBy(rows.filter((x) => x.a.type === "CASH"), (x) => x.balance), bank = sumBy(rows.filter((x) => x.a.type === "BANK"), (x) => x.balance);
  return {
    title: "Kassa qoldig'i", subtitle: asOf(r) ? `${period(r)} oxiridagi holat` : "Hozirgi holat",
    fields: [f("Jami", `${total < 0 ? "−" : ""}${money(Math.abs(total))}`, total >= 0 ? "info" : "danger"), f("Naqd kassa", money(cash)), f("Bank", money(bank)), f("Hisoblar", cnt(accounts.length, "ta")), f(`Davr kirimi (${r.label})`, money(sumBy(rows, (x) => x.inP)), "success"), f(`Davr chiqimi (${r.label})`, money(sumBy(rows, (x) => x.outP)), "warning")],
    sections: [sec("Hisoblar", rows.map((x) => ({ id: x.a.id, title: x.a.name, subtitle: `${x.a.type === "CASH" ? "naqd" : "bank"} · davrda kirim ${short(x.inP)} · chiqim ${short(x.outP)}${Math.abs(x.trP) >= 1 ? ` · o'tkazma ${shortSigned(x.trP)}` : ""}`, right: shortSigned(x.balance), tone: x.balance < 0 ? "danger" : "info" })), { icon: "landmark", empty: "Faol hisob yo'q" })],
  };
}

async function invoicesIssued({ r }: Ctx): Promise<Part> {
  const rows = await db.invoice.findMany({ where: { isOpening: false, date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" }, select: { id: true, invoiceNo: true, date: true, amount: true, status: true, customer: { select: { id: true, name: true } }, order: { select: { orderNo: true } }, payments: { select: { amount: true } } } });
  const total = sumBy(rows, (i) => sum(i.amount));
  const paid = sumBy(rows, (i) => sumBy(i.payments, (p) => sum(p.amount)));
  const TONE: Record<string, Tone> = { OPEN: "warning", PARTIAL: "warning", PAID: "success", CANCELLED: "danger" };
  return {
    title: "Yozilgan schyotlar", subtitle: period(r),
    fields: [f("Jami summa", money(total)), f("Schyotlar", cnt(rows.length, "ta")), f("To'langan", `${money(paid)} · ${share(paid, total)}`, "success"), f("Qoldiq", money(Math.max(0, total - paid)), total - paid > 0 ? "warning" : undefined)],
    sections: pick(
      breakdown("Holat bo'yicha", rows, (i) => INVOICE_LABEL[i.status] ?? i.status, (i) => sum(i.amount), short, { icon: "receipt", unitWord: "schyot" }),
      breakdown("Mijozlar bo'yicha", rows, (i) => i.customer.name, (i) => sum(i.amount), short, { icon: "users", unitWord: "schyot", target: "customers", id: (l) => l[0]!.customer.id, limit: 10 }),
      byDays(r, rows, (i) => i.date, (l) => short(sumBy(l, (i) => sum(i.amount))), (l) => cnt(l.length, "schyot")),
      sec("Schyotlar", rows.slice(0, 60).map((i) => ({ id: i.id, title: `${i.invoiceNo} · ${i.customer.name}`, subtitle: [day(i.date), i.order?.orderNo, `to'landi ${short(sumBy(i.payments, (p) => sum(p.amount)))}`].filter(Boolean).join(" · "), right: short(sum(i.amount)), status: INVOICE_LABEL[i.status], tone: TONE[i.status] })), { target: "invoices", empty: "Bu davrda schyot yozilmagan" }),
    ),
  };
}

async function receivablesDetail(r?: DashRange): Promise<Part> {
  // Yagona debitorka (lib/receivables.ts): schyotlar − barcha to'lovlar; to'lovlar FIFO bilan eng eski schyotlarga.
  // Davr oxiridagi qarz: shu vaqtgacha yozilgan schyotlar − shu vaqtgacha kelgan to'lovlar (joriy davrda — hozir)
  const until = r ? asOf(r) : null;
  const rep = await receivablesReport({ asOf: until, edges: OWNER_EDGES });
  const inv = rep.rows.flatMap((c) => c.items.map((x) => ({ ...x, customer: { id: c.customerId, name: c.name } }))).sort((a, b) => a.date.getTime() - b.date.getTime());
  const aging = rep.labels.map((l, i) => ({ label: i === rep.labels.length - 1 ? `${rep.edges.at(-1)} kundan eski` : `${l} kun`, v: rep.buckets[i]!, old: i === rep.labels.length - 1 }));
  return {
    title: "Debitorka", subtitle: until ? `${period(r!)} oxiridagi qarz` : "Mijoz balansi: schyotlar − barcha to'lovlar",
    fields: [f("Jami qarz", money(rep.total), rep.total > 0 ? "danger" : "success"), f("Qarzdorlar", cnt(rep.debtors, "mijoz")), f("Ochiq schyotlar", cnt(inv.length, "ta")), ...aging.map((a) => f(a.label, money(a.v), a.old && a.v > 0 ? "danger" : undefined)), ...(rep.advance > 0.005 ? [f("Mijozlar avansi", `${money(rep.advance)} · ${cnt(rep.advanceCustomers, "mijoz")}`, "success")] : [])],
    sections: [
      sec("Qarzdorlar", rep.rows.slice(0, 40).map((c) => ({ id: c.customerId, title: c.name, subtitle: `${cnt(c.items.length, "ochiq schyot")} · eng eskisi ${c.oldestDays ?? 0} kun`, right: short(c.debt), tone: (c.oldestDays ?? 0) > 60 ? "danger" : (c.oldestDays ?? 0) > 30 ? "warning" : "info" })), { target: "customers", empty: "Qarzdor yo'q" }),
      sec("Ochiq schyotlar (eskidan yangiga)", inv.slice(0, 60).map((x) => ({ id: x.invoiceId, title: `${x.invoiceNo} · ${x.customer.name}`, subtitle: `${day(x.date)} · ${x.age} kun · summa ${short(x.amount)}`, right: short(x.left), status: INVOICE_LABEL[x.status], tone: x.age > 60 ? "danger" : x.age > 30 ? "warning" : "info" })), { target: "invoices", empty: "Ochiq schyot yo'q" }),
    ],
  };
}

/**
 * Kreditorka batafsili — kartadagi summa bilan bir manba (`./payables.ts`): to'lanmagan kirimlar +
 * boshlang'ich qoldiqdan qolgan qarz + tasdiqlangan (pul hali ajratilmagan) ta'minot zayavkalari.
 * Qarz hozirgi holat — davr tanlovi unga ta'sir qilmaydi.
 */
async function payablesDetail(): Promise<Part> {
  const p = await payables();
  return {
    title: "Kreditorka", subtitle: "Yetkazuvchilarga hozirgi qarzimiz: to'lanmagan kirimlar, boshlang'ich qoldiq va tasdiqlangan ta'minot",
    fields: [
      f("Jami", money(p.total), p.total > 0 ? "warning" : "success"),
      f("To'lanmagan kirimlar", `${money(p.receipts.total)} · ${cnt(p.receipts.count, "hujjat")}`),
      f("Boshlang'ich qoldiq (qolgan)", money(p.opening.total)),
      f("Tasdiqlangan ta'minot (pul ajratilmagan)", `${money(p.supply.total)} · ${cnt(p.supply.count, "zayavka")}`),
      f("Xaridda (pul ajratildi — qarz emas)", `${money(p.funded.total)} · ${cnt(p.funded.count, "zayavka")}`, "brand"),
    ],
    sections: [
      sec("Yetkazuvchilar bo'yicha", p.bySupplier.slice(0, 30).map((s) => ({ id: s.id, title: s.name, subtitle: [s.receipts ? `kirim ${short(s.receipts)}` : null, s.opening ? `boshl. qoldiq ${short(s.opening)}` : null, s.supply ? `ta'minot ${short(s.supply)}` : null].filter(Boolean).join(" · "), right: short(s.total), tone: "warning" as Tone })), { icon: "store", target: "suppliers", empty: "Qarz yo'q" }),
      sec("To'lanmagan kirimlar", p.receipts.rows.slice(0, 60).map((x) => ({ id: x.id, title: `${x.docNo} · ${x.supplier}`, subtitle: `${day(x.date)} · jami ${short(x.total)}${x.paid ? ` · to'langan ${short(x.paid)}` : ""}`, right: short(x.left), tone: "warning" as Tone })), { target: "receipts", empty: "To'lanmagan kirim yo'q" }),
      sec("Tasdiqlangan ta'minot", p.supply.rows.slice(0, 60).map((x) => ({ id: x.id, title: x.label, subtitle: [x.supplier, x.needBy ? `kerak ${day(x.needBy)}` : null].filter(Boolean).join(" · "), right: short(x.total), status: SUPPLY_LABEL.APPROVED, tone: SUPPLY_TONE.APPROVED })), { target: "supply", empty: "Moliya tasdig'ida zayavka yo'q" }),
    ],
  };
}

async function budgetDetail(r: DashRange): Promise<Part> {
  // Oylik byudjet tanlangan davrga bo'linadi (hafta ≈ 7/30), fakt — shu davr chiqimi
  const shares = monthShares(r);
  const [budgets, spent, top] = await Promise.all([
    db.expenseBudget.findMany({ where: { OR: shares.map(({ year, month }) => ({ year, month })) }, orderBy: { amount: "desc" } }),
    db.cashTransaction.groupBy({ by: ["category"], where: { type: "EXPENSE", date: { gte: r.from, lt: r.to } }, _sum: { amount: true } }),
    db.cashTransaction.findMany({ where: { type: "EXPENSE", date: { gte: r.from, lt: r.to } }, orderBy: { amount: "desc" }, take: 15, select: TX_SELECT }),
  ]);
  const fact = (cat: string) => sum(spent.find((x) => x.category === cat)?._sum.amount);
  const share = (b: { year: number; month: number }) => shares.find((m) => m.year === b.year && m.month === b.month)?.share ?? 0;
  const rows = groupBy(budgets, (b) => b.category).map(([cat, list]) => {
    const plan = sumBy(list, (b) => sum(b.amount) * share(b));
    const limit = sumBy(list, (b) => sum(b.limit) * share(b));
    return { id: list[0]!.id, category: cat, plan, limit, fact: fact(cat), pct: plan > 0 ? (fact(cat) / plan) * 100 : null };
  });
  const planTotal = sumBy(rows, (x) => x.plan), factTotal = sumBy(rows, (x) => x.fact);
  const unplanned = spent.filter((x) => !budgets.some((b) => b.category === x.category));
  const over = rows.filter((x) => x.pct != null && x.pct > 100);
  return {
    title: `Byudjet — ${period(r)}`, subtitle: "plan / fakt · oylik byudjet davrga bo'lingan",
    fields: [f("Byudjet", money(planTotal)), f("Sarflandi", `${money(factTotal)} · ${pctText(planTotal > 0 ? (factTotal / planTotal) * 100 : null)}`, factTotal > planTotal ? "danger" : factTotal > planTotal * 0.9 ? "warning" : "success"), f("Oshgan kategoriyalar", String(over.length), over.length ? "danger" : "success"), f("Byudjetsiz xarajat", money(sumBy(unplanned, (u) => sum(u._sum.amount))), unplanned.length ? "warning" : undefined)],
    sections: [
      sec("Kategoriyalar", [...rows.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).map((x) => ({ id: x.id, title: x.category, subtitle: `fakt ${short(x.fact)} · plan ${short(x.plan)}${x.limit ? ` · limit ${short(x.limit)}` : ""}`, right: pctText(x.pct), tone: (x.pct == null ? "info" : x.pct > 100 ? "danger" : x.pct > 90 ? "warning" : "success") as Tone })),
        ...unplanned.map((u, i) => ({ id: `u${i}`, title: u.category, subtitle: "byudjet belgilanmagan", right: short(sum(u._sum.amount)), tone: "warning" as Tone }))], { icon: "square-check", empty: "Bu davrga byudjet belgilanmagan" }),
      sec(`Eng katta chiqimlar (${period(r)})`, top.map(txRow), { target: "cashflow", empty: "Bu davrda chiqim yo'q" }),
    ],
  };
}

// ───────────────────────── Kadrlar ─────────────────────────

const ATT_SELECT = { id: true, date: true, status: true, checkIn: true, checkOut: true, note: true, employee: { select: { id: true, fullName: true, position: true } } } as const;
type AttRow = { id: string; date: Date; status: string; checkIn: string | null; checkOut: string | null; note: string | null; employee: { id: string; fullName: string; position: string } };
const ATT_TONE: Record<string, Tone> = { PRESENT: "success", ABSENT: "danger", SICK: "warning", LEAVE: "info", DAYOFF: "info" };
/** Xodimlar bo'yicha: har xodim uchun belgilar soni (target — xodim kartochkasi). */
const attByEmployee = (title: string, rows: AttRow[], right: (list: AttRow[]) => string, tone: (list: AttRow[]) => Tone, empty: string) =>
  sec(title, groupBy(rows, (a) => a.employee.id).map(([id, list]) => ({ id, list })).sort((a, b) => b.list.length - a.list.length).slice(0, 80)
    .map((g) => ({ id: g.id, title: g.list[0]!.employee.fullName, subtitle: g.list[0]!.employee.position, right: right(g.list), tone: tone(g.list) })), { target: "employees", empty });

async function attendance({ r }: Ctx): Promise<Part> {
  const [rows, active] = await Promise.all([
    db.attendance.findMany({ where: { date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" }, select: ATT_SELECT }),
    db.employee.count({ where: { isActive: true } }),
  ]);
  const by = (s: string) => rows.filter((a) => a.status === s).length;
  const present = by("PRESENT"), absent = by("ABSENT"), sick = by("SICK"), leave = by("LEAVE");
  const marked = present + absent + sick + leave;
  const pct = marked ? (present / marked) * 100 : null;
  const notMarked = r.key === "day" ? Math.max(0, active - rows.length) : null;
  return {
    title: "Davomat", subtitle: period(r),
    fields: [
      f("Kelganlar ulushi", pctText(pct), pct == null ? undefined : pct >= 90 ? "success" : pct >= 75 ? "warning" : "danger"),
      f("Keldi", cnt(present, "belgi"), "success"), f("Kelmadi (sababsiz)", cnt(absent, "belgi"), absent ? "danger" : undefined), f("Kasal / ta'til", `${sick} / ${leave}`), f("Dam olish", cnt(by("DAYOFF"), "belgi")),
      ...(notMarked != null ? [f("Belgilanmagan (bugun)", cnt(notMarked, "xodim"), notMarked ? "warning" : "success")] : []),
    ],
    sections: pick(
      byDays(r, rows, (a) => a.date, (l) => `${l.filter((a) => a.status === "PRESENT").length} keldi`, (l) => `kelmadi ${l.filter((a) => a.status === "ABSENT").length} · kasal/ta'til ${l.filter((a) => a.status === "SICK" || a.status === "LEAVE").length}`),
      breakdown("Tarkib", rows, (a) => ATT_LABEL[a.status] ?? a.status, () => 1, (v) => cnt(v, "belgi"), { icon: "calendar", unitWord: "belgi" }),
      attByEmployee("Xodimlar bo'yicha", rows, (l) => `${l.filter((a) => a.status === "PRESENT").length} keldi · ${l.filter((a) => a.status === "ABSENT").length} kelmadi`, (l) => (l.some((a) => a.status === "ABSENT") ? "warning" : "success"), "Bu davrda davomat belgilanmagan"),
    ),
  };
}

async function attendanceOf(r: DashRange, statuses: string[], title: string): Promise<Part> {
  const rows = await db.attendance.findMany({ where: { date: { gte: r.from, lt: r.to }, status: { in: statuses as never } }, orderBy: { date: "desc" }, select: ATT_SELECT });
  return {
    title, subtitle: period(r),
    fields: [f("Belgilar", cnt(rows.length, "ta")), f("Xodimlar", cnt(new Set(rows.map((a) => a.employee.id)).size, "kishi")), ...(statuses.length > 1 ? statuses : []).map((s) => f(ATT_LABEL[s] ?? s, cnt(rows.filter((a) => a.status === s).length, "belgi")))],
    sections: pick(
      attByEmployee("Xodimlar bo'yicha", rows, (l) => cnt(l.length, "kun"), (l) => ATT_TONE[l[0]!.status] ?? "info", "Bu davrda belgi yo'q"),
      byDays(r, rows, (a) => a.date, (l) => cnt(l.length, "kishi"), (l) => l.slice(0, 3).map((a) => a.employee.fullName).join(", ") + (l.length > 3 ? ` +${l.length - 3}` : "")),
      sec("Belgilar", rows.slice(0, 60).map((a) => ({ id: a.id, title: a.employee.fullName, subtitle: [day(a.date), a.employee.position, a.note].filter(Boolean).join(" · "), status: ATT_LABEL[a.status], tone: ATT_TONE[a.status] })), { icon: "user-x", empty: "Belgi yo'q" }),
    ),
  };
}

async function hiredFired({ r }: Ctx): Promise<Part> {
  const [hired, fired] = await Promise.all([
    db.employee.findMany({ where: { hiredAt: { gte: r.from, lt: r.to } }, orderBy: { hiredAt: "desc" }, select: { id: true, fullName: true, position: true, hiredAt: true, subdivision: true } }),
    db.employee.findMany({ where: { firedAt: { gte: r.from, lt: r.to } }, orderBy: { firedAt: "desc" }, select: { id: true, fullName: true, position: true, firedAt: true, firedReason: true } }),
  ]);
  return {
    title: "Kadrlar harakati", subtitle: period(r),
    fields: [f("Ishga olindi", cnt(hired.length, "kishi"), "success"), f("Bo'shadi", cnt(fired.length, "kishi"), fired.length ? "warning" : undefined), f("Sof o'zgarish", `${hired.length - fired.length >= 0 ? "+" : ""}${hired.length - fired.length}`)],
    sections: pick(
      breakdown("Lavozimlar bo'yicha (yangi)", hired, (e) => e.position, () => 1, (v) => cnt(v, "kishi"), { icon: "id-card" }),
      sec("Yangi xodimlar", hired.map((e) => ({ id: e.id, title: e.fullName, subtitle: [e.position, e.subdivision, e.hiredAt ? day(e.hiredAt) : null].filter(Boolean).join(" · "), tone: "success" })), { target: "employees", empty: "Bu davrda yangi xodim yo'q" }),
      sec("Bo'shaganlar", fired.map((e) => ({ id: e.id, title: e.fullName, subtitle: [e.position, e.firedAt ? day(e.firedAt) : null, e.firedReason].filter(Boolean).join(" · "), tone: "warning" })), { target: "employees", empty: "Bu davrda bo'shagan xodim yo'q" }),
    ),
  };
}

async function activeStaff(r?: DashRange): Promise<Part> {
  const rows = await db.employee.findMany({ where: r ? staffAt(r) : { isActive: true }, orderBy: [{ position: "asc" }, { fullName: "asc" }], select: { id: true, fullName: true, position: true, subdivision: true, phone: true, brigade: { select: { name: true } } } });
  return {
    title: "Faol xodimlar", subtitle: r && asOf(r) ? `${period(r)} oxirida ishlaganlar` : "Hozirgi holat",
    fields: [f("Jami", cnt(rows.length, "kishi")), f("Lavozimlar", String(new Set(rows.map((e) => e.position)).size)), f("Bo'linmalar", String(new Set(rows.map((e) => e.subdivision).filter(Boolean)).size))],
    sections: pick(
      breakdown("Lavozimlar bo'yicha", rows, (e) => e.position, () => 1, (v) => cnt(v, "kishi"), { icon: "id-card", unitWord: "kishi", limit: 30 }),
      rows.some((e) => e.subdivision) && breakdown("Bo'linmalar bo'yicha", rows, (e) => e.subdivision ?? "—", () => 1, (v) => cnt(v, "kishi"), { icon: "building", unitWord: "kishi", limit: 30 }),
      sec("Xodimlar", rows.slice(0, 120).map((e) => ({ id: e.id, title: e.fullName, subtitle: [e.position, e.subdivision, e.brigade?.name, e.phone].filter(Boolean).join(" · ") })), { target: "employees", empty: "Faol xodim yo'q" }),
    ),
  };
}

// ───────────────────────── Direktor (Egasi dashbordi) ─────────────────────────

/** Sof foyda — oydan boshqa davr uchun (formula Egasi dashbordi bilan bir xil), mahsulot marjasi bilan. */
async function ownerProfitPeriod(r: DashRange): Promise<Part> {
  const [P, sales] = await Promise.all([ownerPeriod(r), loadSales(r.from, r.to)]);
  const x = P.profit;
  const byProduct = groupBy(sales, (s) => s.productId).map(([id, list]) => {
    const rev = sumBy(list, (s) => s.revenue), cost = sumBy(list, (s) => s.cost);
    return { id, title: `${list[0]!.code} · ${list[0]!.product}`, rev, cost, qty: sumBy(list, (s) => s.qty), unit: list[0]!.unit, margin: rev > 0 ? ((rev - cost) / rev) * 100 : 0 };
  }).sort((a, b) => b.rev - a.rev);
  return {
    title: `Sof foyda — ${period(r)}`, subtitle: "tushum − tannarx (retsept) − operatsion xarajat",
    fields: [
      f("Sof foyda", shortSigned(x.net), x.net < 0 ? "danger" : "success"), f("Tushum", money(x.revenue)), f("Tannarx", money(x.cogs)),
      f("Yalpi foyda", money(x.gross)), f("Operatsion xarajat", money(x.opex)), f("Marja", pctText(x.revenue > 0 ? (x.net / x.revenue) * 100 : null)),
    ],
    sections: [
      sec("Mahsulot marjasi", byProduct.map((p) => ({ id: p.id, title: p.title, subtitle: `sotuv ${short(p.rev)} · tannarx ${short(p.cost)} · ${inUnit(p.qty, p.unit)}`, right: pctText(p.margin), tone: (p.margin >= 20 ? "success" : p.margin >= 10 ? "warning" : "danger") as Tone })), { icon: "package", empty: "Bu davrda sotuv yo'q" }),
    ],
  };
}

async function ownerProfit(): Promise<Part> {
  const d = await ownerCached();
  const S = d.summary;
  const tone = (l: string): Tone => (l === "crit" ? "danger" : l === "warn" ? "warning" : "success");
  return {
    title: "Sof foyda", subtitle: "Joriy oy · Egasi dashbordi bilan bir manba",
    fields: [
      f("Sof foyda (oy)", shortSigned(S.profit.month) === short(Math.abs(S.profit.month)) ? money(S.profit.month) : `−${money(-S.profit.month)}`, tone(d.levels.profit)),
      f("Bugun", `${S.profit.today < 0 ? "−" : ""}${money(Math.abs(S.profit.today))}`), f("Plan (oy)", S.profit.plan == null ? "—" : money(S.profit.plan)), f("Prognoz (oy oxiri)", money(S.profit.forecast)),
      f("Yalpi foyda", money(S.profit.gross)), f("Marja", `${pctText(S.margin.total)}${S.margin.plan != null ? ` · plan ${pctText(S.margin.plan)}` : ""}`),
    ],
    sections: [
      sec("Foyda jadvali (oy)", d.profitTable.map((x) => ({ id: x.key, title: x.label, subtitle: `bugun ${shortSigned(x.today)}${x.plan != null ? ` · plan ${short(x.plan)}` : ""}`, right: shortSigned(x.month), tone: (x.pct == null ? "info" : x.invert ? (x.pct > 100 ? "danger" : "success") : x.pct >= 90 ? "success" : x.pct >= 60 ? "warning" : "danger") as Tone })), { icon: "banknote" }),
      sec("Mahsulot marjasi", S.margin.byProduct.map((p) => ({ id: p.id, title: `${p.code} · ${p.name}`, subtitle: `sotuv ${short(p.revenue)} · tannarx ${short(p.cost)} · ${inUnit(p.qty, p.unit)}`, right: pctText(p.margin), tone: (p.margin >= 20 ? "success" : p.margin >= 10 ? "warning" : "danger") as Tone })), { icon: "package", empty: "Bu oyda sotuv yo'q" }),
      sec("Dinamika — 3 oy", d.trend.map((t) => ({ id: `tr-${t.key}`, title: t.label, subtitle: `tushum ${short(t.revenue)} · xarajat ${short(t.expenses)}`, right: shortSigned(t.profit), tone: (t.profit >= 0 ? "success" : "danger") as Tone })), { icon: "chart-column" }),
    ],
  };
}

async function ownerExpenses(): Promise<Part> {
  const d = await ownerCached();
  const E = d.expenses;
  const tone = (l: string): Tone => (l === "crit" ? "danger" : l === "warn" ? "warning" : "success");
  return {
    title: "Xarajatlar", subtitle: "Joriy oy · byudjet bilan taqqoslash",
    fields: [f("Jami (oy)", money(E.total), tone(d.levels.expenses)), f("Byudjet", E.plan == null ? "belgilanmagan" : money(E.plan)), f("Tushumga nisbatan", pctText(E.ratio)), f("Prognoz (oy oxiri)", money(E.forecast)), f("Byudjetdan oshgan", cnt(E.overspent.length, "kategoriya"), E.overspent.length ? "danger" : "success"), f("Rejalashtirilmagan", cnt(E.unplanned.length, "kategoriya"), E.unplanned.length ? "warning" : undefined)],
    sections: [
      sec("Kategoriyalar (plan / fakt)", E.categories.filter((c) => c.month > 0 || c.plan).map((c, i) => ({ id: `c${i}`, title: c.cat, subtitle: `${c.plan == null ? "byudjetsiz" : `plan ${short(c.plan)}`} · prognoz ${short(c.forecast)}${c.day ? ` · bugun ${short(c.day)}` : ""}`, right: `${short(c.month)}${c.pct != null ? ` · ${pctText(c.pct)}` : ""}`, tone: tone(c.level) })), { icon: "chart-pie", empty: "Bu oyda xarajat yo'q" }),
      sec("Eng katta chiqimlar", E.top10.map((t) => ({ id: t.id, title: `${t.category} · ${t.who}`, subtitle: [day(t.date), t.account, t.by, t.note].filter(Boolean).join(" · "), right: short(t.amount), tone: "warning" as Tone })), { target: "cashflow", empty: "Chiqim yo'q" }),
    ],
  };
}

async function ownerCash(): Promise<Part> {
  const d = await ownerCached();
  const C = d.cashflow, S = d.summary.cash;
  return {
    title: "Pul", subtitle: "Hozirgi qoldiq va bugungi oqim",
    fields: [
      f("Jami", `${S.total < 0 ? "−" : ""}${money(Math.abs(S.total))}`, d.levels.cash === "crit" ? "danger" : d.levels.cash === "warn" ? "warning" : "info"), f("Kassa", money(S.cash)), f("Bank", money(S.bank)),
      f("Kun boshida", money(C.startOfDay)), f("Bugun kirdi", money(C.inToday), "success"), f("Bugun chiqdi", money(C.outToday), "warning"),
      f("O'rtacha kunlik kirim / chiqim", `${short(C.avgDailyIn)} / ${short(C.avgDailyOut)}`), f("Rejadagi to'lovlar (7 kun)", money(d.summary.payable.d7)),
      ...(S.gapDay != null ? [f("Pul yetmay qolish kuni", String(S.gapDay), "danger")] : []),
    ],
    sections: [
      sec("Hisoblar", C.accounts.map((a) => ({ id: a.id, title: a.name, subtitle: a.type === "CASH" ? "naqd" : "bank", right: shortSigned(a.balance), tone: (a.balance < 0 ? "danger" : "info") as Tone })), { icon: "landmark", empty: "Hisob yo'q" }),
      sec("Eng katta tushumlar (oy)", C.topIn.map((p) => ({ id: p.id, title: p.who, subtitle: `${day(p.date)} · ${p.account}`, right: short(p.amount), tone: "success" as Tone })), { target: "payments", empty: "Bu oyda to'lov yo'q" }),
      sec("Eng katta chiqimlar (oy)", C.topOut.map((t) => ({ id: t.id, title: `${t.category} · ${t.who}`, subtitle: `${day(t.date)} · ${t.account}`, right: short(t.amount), tone: "warning" as Tone })), { target: "cashflow", empty: "Bu oyda chiqim yo'q" }),
    ],
  };
}

async function ownerProblems(): Promise<Part> {
  const d = await ownerCached();
  const tone = (l: string): Tone => (l === "crit" ? "danger" : l === "warn" ? "warning" : "success");
  return {
    title: "Muammolar", subtitle: "Egasi qarori kerak bo'lgan masalalar",
    fields: [f("Qaror kutayotgan", cnt(d.decisions.length, "masala"), d.decisions.length ? (d.decisions.some((x) => x.level === "crit") ? "danger" : "warning") : "success"), f("Kritik", String(d.decisions.filter((x) => x.level === "crit").length)), f("Yo'qotish (fakt, oy)", money(d.leaks.lossTotal), d.leaks.lossTotal > 0 ? "warning" : "success"), f("Xavf / muzlagan pul", money(d.leaks.riskTotal), d.leaks.riskTotal > 0 ? "warning" : "success")],
    sections: [
      sec("Qaror kerak", d.decisions.map((x) => ({ id: x.key, title: x.problem, subtitle: `${x.decision} · ${x.owner} · ${x.due}${x.effect ? ` · ${x.effect}` : ""}`, right: x.amount ? short(Math.abs(x.amount)) : undefined, tone: tone(x.level) })), { icon: "triangle-alert", target: "problem", empty: "Qaror talab qiladigan masala yo'q" }),
      sec("Yo'qotish (fakt)", d.leaks.loss.filter((l) => l.amount > 0).map((l) => ({ id: `leak-${l.key}`, title: l.title, subtitle: String(l.text), right: short(l.amount), tone: "warning" as Tone, open: webList(l.href) })), { icon: "droplets", empty: "Yo'qotish topilmadi" }),
      sec("Xavf / muzlagan pul", d.leaks.risk.filter((l) => l.level !== "ok").map((l) => ({ id: `risk-${l.key}`, title: l.title, subtitle: String(l.text), right: l.amount !== null ? short(l.amount) : undefined, tone: tone(l.level), open: webList(l.href) })), { icon: "triangle-alert", empty: "Xavf yo'q" }),
    ],
  };
}

async function ownerProduction(): Promise<Part> {
  const d = await ownerCached();
  const P = d.production, S = d.summary.production;
  const t0 = today0(), t1 = new Date(t0); t1.setDate(t1.getDate() + 1);
  const batches = await db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: t0, lt: t1 } }, orderBy: { date: "desc" }, select: { id: true, batchNo: true, date: true, shift: true, qtyM3: true, product: { select: { name: true, unit: true } }, order: { select: { orderNo: true, customer: { select: { name: true } } } } } });
  const tone = (l: string): Tone => (l === "crit" ? "danger" : l === "warn" ? "warning" : "success");
  return {
    title: "Ishlab chiqarish", subtitle: "Joriy oy · plan / fakt",
    fields: [f("Beton (oy)", `${num(S.concreteMonth)} m³${S.concretePlan ? ` / ${num(S.concretePlan)} m³ · ${share(S.concreteMonth, S.concretePlan)}` : ""}`, tone(d.levels.production)), f("Bugun", `${num(S.concreteToday)} m³ · ${cnt(batches.length, "zames")}`), f("Quvvat yuklanishi", pctText(S.capacityPct)), f("Plan qatorlari", cnt(P.rows.length, "mahsulot"))],
    sections: [
      sec("Mahsulotlar (plan / fakt)", P.rows.map((x) => ({ id: x.id, title: `${x.code} · ${x.name}`, subtitle: `plan ${inUnit(x.plan, x.unit)} · fakt ${inUnit(x.fact, x.unit)} · bugun ${inUnit(x.factDay, x.unit)}${x.behind > 0 ? ` · ortda ${inUnit(x.behind, x.unit)}` : ""}`, right: pctText(x.pct), tone: tone(x.level) })), { icon: "factory", empty: "Bu oyga plan belgilanmagan" }),
      sec("Bugungi zameslar", batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: `${time(b.date)} · ${b.shift}-smena · ${b.order ? `${b.order.orderNo} ${b.order.customer.name}` : "Omborga"}`, right: inUnit(sum(b.qtyM3), b.product.unit) })), { target: "production", empty: "Bugun zames yo'q" }),
    ],
  };
}

async function ownerShipment(): Promise<Part> {
  const d = await ownerCached();
  const S = d.summary.shipment, T = d.transport;
  const part = await deliveredTrips(dashRange({ period: "month" }), null, "Otgruzka");
  return {
    ...part, subtitle: "Joriy oy",
    fields: [
      f("Otgruzka (oy)", `${num(S.month)} m³${S.plan ? ` / sotilgan ${num(S.plan)} m³ · ${share(S.month, S.plan)}` : ""}`), f("Bugun", `${num(S.today)} m³ · ${cnt(S.tripsToday, "reys")}`),
      f("O'rtacha reys", `${num(T.avgM3)} m³`), f("Texnika", `${T.working} ishda · ${T.free} bo'sh · ${T.repair.length} ta'mirda · ${T.idle.length} bekor`, T.repair.length + T.idle.length ? "warning" : "success"),
      f("Yoqilg'i (oy)", `${money(T.fuelFact)}${T.fuelNorm != null ? ` / norma ${money(T.fuelNorm)}` : ""}`, T.fuelOver > 0 ? "danger" : undefined),
      ...part.fields.filter((x) => x.label === "Kechikkan (>15 daq)"),
    ],
  };
}

async function ownerReceivable(): Promise<Part> {
  const base = await receivablesDetail();
  const d = await ownerCached();
  return { ...base, fields: [...base.fields.slice(0, 3), f("Muddati o'tgan", money(d.summary.receivable.overdue), d.summary.receivable.overdue > 0 ? "danger" : "success"), ...base.fields.slice(3)] };
}

// ───────────────────────── Eski holat kartalari (bosh ekranda dashboard bilan yonma-yon) ─────────────────────────

async function blockedOrders(): Promise<Part> {
  const rows = await db.order.findMany({ where: { status: "BLOCKED", kind: "SALE" }, orderBy: { deliveryDate: "asc" }, select: { id: true, orderNo: true, deliveryDate: true, onCredit: true, customer: { select: { id: true, name: true, creditLimit: true } }, items: { select: { qtyM3: true, price: true, product: { select: { name: true, unit: true } } } }, createdBy: { select: { fullName: true } } } });
  const total = (o: (typeof rows)[number]) => sumBy(o.items, (i) => sum(i.qtyM3) * sum(i.price));
  return {
    title: "Bloklangan zayavkalar", subtitle: "Limit yoki qarz sababli to'xtatilgan — direktor ochadi",
    fields: [f("Jami", cnt(rows.length, "ta"), rows.length ? "danger" : "success"), f("Summa", money(sumBy(rows, total))), f("Mijozlar", cnt(new Set(rows.map((o) => o.customer.id)).size, "ta"))],
    sections: [sec("Zayavkalar", rows.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer.name}`, subtitle: `${day(o.deliveryDate)} · ${o.items.map((i) => i.product.name).slice(0, 3).join(", ")} · ${o.createdBy.fullName}${o.onCredit ? " · nasiyaga" : ""}`, right: short(total(o)), status: ORDER_LABEL.BLOCKED, tone: "danger" })), { target: "orders", empty: "Bloklangan zayavka yo'q" })],
  };
}

type DashTripRow = Awaited<ReturnType<typeof logisticsDashboard>>["trips"][number];
const LEVEL_TONE: Record<string, Tone> = { ok: "success", warn: "warning", crit: "danger" };
const dashTripRow = (t: DashTripRow): HomeRow => ({
  id: t.id, title: `${t.noteNo} · ${t.customer}`,
  subtitle: [t.driver, t.plate, t.plannedAt ? `reja ${time(t.plannedAt)}` : null, t.delayMin && t.delayMin > 0 ? `kechikish ${t.delayMin} daq` : null, t.openIssues ? cnt(t.openIssues, "muammo") : null].filter(Boolean).join(" · "),
  right: inUnit(t.qty, t.unit), status: TRIP_LABEL[t.status] ?? t.status, tone: t.level === "ok" ? TRIP_TONE[t.status] : LEVEL_TONE[t.level],
});

/** Logistika bugungi holati (`logisticsDashboard()` bilan bir manba): bugungi reyslar / yo'ldagi transport / kutayotgan buyurtmalar. */
async function logiToday(kind: "today" | "onroad" | "waiting"): Promise<Part> {
  const d = await logisticsDashboard();
  const k = d.kpi;
  if (kind === "waiting") {
    const rows = d.orders.filter((o) => ["CONFIRMED", "PLANNED"].includes(o.status) || (["ASSIGNED", "LOADING", "ON_ROAD"].includes(o.status) && o.remaining > 0.001));
    return {
      title: "Kutayotgan buyurtmalar", subtitle: "Bugun · transport biriktirilmagan yoki qoldig'i bor",
      fields: [f("Buyurtmalar", cnt(k.waitingOrders, "ta"), k.waitingOrders ? "warning" : "success"), f("Biriktirilmagan hajm", `${num(k.waitingQty)}`), f("Bo'sh transport", `${k.freeVehicles} / ${k.totalVehicles}`)],
      sections: [sec("Buyurtmalar", rows.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer}`, subtitle: [o.deliveryTime ?? "soatsiz", o.address, o.needsPump ? "nasos" : null, o.isUrgent ? "shoshilinch" : null].filter(Boolean).join(" · "), right: `qoldi ${inUnit(o.remaining, o.unit)} / ${inUnit(o.total, o.unit)}`, status: ORDER_LOGI[o.status]?.label ?? o.status, tone: o.problem ? "danger" : o.late ? "warning" : "info" })), { target: "orders", empty: "Kutayotgan buyurtma yo'q" })],
    };
  }
  if (kind === "onroad") {
    const trips = d.trips.filter((t) => t.status === "ON_ROAD" || t.status === "LOADED");
    const free = d.vehicles.filter((v) => v.live === "FREE");
    return {
      title: "Yo'ldagi transport", subtitle: "Hozirgi holat",
      fields: [f("Yo'lda", cnt(k.onRoad, "mashina"), "brand"), f("Bo'sh", `${k.freeVehicles} / ${k.totalVehicles}`), f("Ta'mirda / bekor", String(d.vehicles.filter((v) => v.live === "REPAIR" || v.live === "IDLE").length)), f("Kechikayotgan reys", String(trips.filter((t) => (t.delayMin ?? 0) > 0).length), trips.some((t) => (t.delayMin ?? 0) > 0) ? "danger" : "success")],
      sections: [
        sec("Yo'ldagi reyslar", trips.map(dashTripRow), { target: "trips", empty: "Hozir yo'lda reys yo'q" }),
        sec("Bo'sh transport", free.map((v) => ({ id: v.id, title: v.plate, subtitle: [v.type, v.driver, v.todayTrips ? `bugun ${cnt(v.todayTrips, "reys")}` : "bugun reys yo'q"].filter(Boolean).join(" · "), tone: "success" })), { icon: "truck", empty: "Bo'sh mashina yo'q" }),
      ],
    };
  }
  const inDay = (x: Date | null) => !!x && x >= today0() && x < new Date(today0().getTime() + 86_400_000);
  const rows = d.trips.filter((t) => ["PLANNED", "LOADED", "ON_ROAD"].includes(t.status) || inDay(t.deliveredAt) || inDay(t.loadedAt) || inDay(t.plannedAt));
  return {
    title: "Bugungi reyslar", subtitle: `Bugun · ${day(d.day)}`,
    fields: [f("Reyslar", cnt(k.trips, "ta")), f("Yakunlandi", String(k.done), "success"), f("Yo'lda", String(k.onRoad), "brand"), f("Kechikkan", String(k.late), k.late ? "danger" : "success"), f("Beton", `${num(k.concreteM3)} m³`), f("Vaqtida yetkazish", pctText(k.onTimePct))],
    sections: pick(
      breakdown("Holat bo'yicha", rows, (t) => TRIP_LABEL[t.status] ?? t.status, () => 1, (v) => cnt(v, "reys"), { icon: "route", unitWord: "reys" }),
      sec("Reyslar", rows.map(dashTripRow), { target: "trips", empty: "Bugun reys yo'q" }),
    ),
  };
}

async function inactiveStaff(): Promise<Part> {
  const rows = await db.employee.findMany({ where: { isActive: false }, orderBy: [{ firedAt: "desc" }], select: { id: true, fullName: true, position: true, firedAt: true, firedReason: true, hiredAt: true } });
  return {
    title: "Nofaol xodimlar", subtitle: "Ishdan bo'shagan yoki faolsizlantirilgan",
    fields: [f("Jami", cnt(rows.length, "kishi")), f("Shu yil bo'shaganlar", String(rows.filter((e) => e.firedAt && e.firedAt.getFullYear() === new Date().getFullYear()).length))],
    sections: pick(
      breakdown("Lavozimlar bo'yicha", rows, (e) => e.position, () => 1, (v) => cnt(v, "kishi"), { icon: "id-card" }),
      sec("Xodimlar", rows.slice(0, 100).map((e) => ({ id: e.id, title: e.fullName, subtitle: [e.position, e.firedAt ? `bo'shadi ${day(e.firedAt)}` : null, e.firedReason].filter(Boolean).join(" · "), tone: "info" })), { target: "employees", empty: "Nofaol xodim yo'q" }),
    ),
  };
}

// ───────────────────────── Rollar jadvali ─────────────────────────

const brig = async (c: Ctx) => myBrigadeIds(c.user.id);
const drv = async (c: Ctx) => driverEmployeeId(c.user.id);

const BUILDERS: Partial<Record<Role, Record<string, Builder>>> = {
  SALES: {
    revenue: (c) => salesRevenue(c.r),
    mine: (c) => salesRevenue(c.r, c.user.id, "Mening sotuvim"),
    volume: salesVolume, leads: salesLeads, customers: salesCustomers,
    blocked: () => blockedOrders(),
  },
  SUPERVISOR: {
    done: (c) => workDone(c.r, null, "Bajarilgan ish"),
    closed: (c) => tasksClosed(c.r, null),
    open: (c) => tasksOpen(null, "all", c.r),
    overdue: (c) => tasksOpen(null, "overdue", c.r),
    active: brigadesActive,
  },
  BRIGADIER: {
    fact: async (c) => workDone(c.r, await brig(c), "Bajardik"),
    plan: async (c) => brigadierPlan(c.r, await brig(c)),
    pct: async (c) => brigadierPct(c.r, await brig(c)),
    inwork: async (c) => tasksOpen(await brig(c), "inwork", c.r),
    overdue: async (c) => tasksOpen(await brig(c), "overdue", c.r),
    defect: async (c) => defects(c.r, await brig(c)),
    issues: async (c) => brigadierIssues(c.r, await brig(c)),
  },
  LOGISTICS: {
    delivered: (c) => deliveredTrips(c.r, null),
    trips: (c) => createdTrips(c.r, null),
    avg: tripDurations, late: lateTrips,
    fuel: (c) => fuelLogs(c.r, null),
    cost: transportCosts,
    issues: (c) => tripIssues(c.r, null),
    today: () => logiToday("today"), onroad: () => logiToday("onroad"), waiting: () => logiToday("waiting"),
  },
  DRIVER: {
    delivered: async (c) => deliveredTrips(c.r, await drv(c), "Yetkazdim"),
    trips: async (c) => createdTrips(c.r, await drv(c)),
    km: driverKm,
    fuel: async (c) => fuelLogs(c.r, await drv(c)),
    issues: async (c) => tripIssues(c.r, await drv(c)),
  },
  WAREHOUSE: {
    receipts: (c) => goodsReceipts(c.r, "Kirim"),
    low: (c) => lowStock(c.r),
    consume: (c) => stockMoves(c.r, ["PRODUCTION_CONSUME"], "Zames sarfi", "retsept bo'yicha xomashyo"),
    adjust: (c) => stockMoves(c.r, ["ADJUSTMENT"], "Inventarizatsiya", "tuzatish yozuvlari"),
    brigade: (c) => stockMoves(c.r, ["BRIGADE_ISSUE", "BRIGADE_RETURN"], "Brigadaga berilgan", "berildi / qaytdi"),
  },
  PROCUREMENT: {
    purchases: (c) => goodsReceipts(c.r, "Xarid"),
    open: (c) => procOpen(c.r),
    urgent: (c) => procList("urgent", c.r), orders: (c) => procList("orders", c.r), transit: (c) => procList("transit", c.r), late: (c) => procList("late", c.r),
    avg: procAvgDays,
  },
  MECHANIC: {
    shipped: (c) => deliveredTrips(c.r, null, "Jo'natildi"),
    "t-orders": (c) => mechToday("orders", c.r), "t-shipped": (c) => mechToday("shipped", c.r), "t-left": (c) => mechToday("left", c.r), "t-problem": (c) => mechToday("problem", c.r),
    "t-volume": (c) => mechProducts("today", c.r), "n-need": (c) => mechProducts("need", c.r), "n-stock": (c) => mechProducts("stock", c.r), "n-short": (c) => mechProducts("short", c.r),
    "n-orders": (c) => mechTomorrow("orders", c.r), "n-trucks": (c) => mechTomorrow("trucks", c.r),
  },
  ACCOUNTING: {
    payments: (c) => payments(c.r, "To'lovlar"),
    invoiced: invoicesIssued,
    receivable: (c) => receivablesDetail(c.r),
    payable: () => payablesDetail(),
    expense: (c) => expenses(c.r),
  },
  FINANCE: {
    net: netFlow,
    in: (c) => income(c.r),
    out: (c) => expenses(c.r),
    balance: balances,
    budget: (c) => budgetDetail(c.r),
  },
  CASHIER: {
    payments: (c) => payments(c.r, "Tushum"),
    out: (c) => expenses(c.r),
    balance: balances,
  },
  HR: {
    attendance,
    absent: (c) => attendanceOf(c.r, ["ABSENT"], "Kelmaganlar"),
    sick: (c) => attendanceOf(c.r, ["SICK", "LEAVE"], "Kasal / ta'til"),
    hired: hiredFired,
    active: (c) => activeStaff(c.r),
    inactive: () => inactiveStaff(),
  },
  DIRECTOR: {
    revenue: (c) => salesRevenue(c.r, undefined, "Tushum"),
    // "Oy" — Egasi dashbordi (vebdagi raqam); boshqa davr — shu davr bo'yicha
    profit: (c) => (c.r.key === "month" ? ownerProfit() : ownerProfitPeriod(c.r)),
    expenses: (c) => (c.r.key === "month" ? ownerExpenses() : expenses(c.r)),
    cash: (c) => (c.r.key === "month" ? ownerCash() : balances(c)),
    receivable: (c) => (c.r.key === "month" ? ownerReceivable() : receivablesDetail(c.r)),
    problems: () => ownerProblems(),
    production: () => ownerProduction(),
    shipment: (c) => (c.r.key === "month" ? ownerShipment() : deliveredTrips(c.r, null, "Otgruzka")),
  },
};

/** Bosh ekran shu karta uchun batafsil bor-yo'qligini shundan biladi (`home.ts` — `open` qo'yadi). */
export const hasDashDetail = (role: Role, key: string) => !!BUILDERS[role]?.[key];

export async function dashDetail(user: MobileUser, rawId: string): Promise<MobileDetail> {
  const [stat, per] = rawId.split(".");
  const own = BUILDERS[user.role];
  const build = own && Object.hasOwn(own, stat ?? "") ? own[stat!] : undefined; // "constructor.x" — kartochka emas
  if (!build) throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  const part = await build({ user, r: parsePeriod(per) });
  return { key: "dash", id: rawId, actions: [], ...part };
}
