import { db } from "@/lib/db";
import { loadSales } from "@/lib/bi/core";
import { ownerDashboard } from "@/lib/owner-dashboard";
import { driverPositionNames } from "@/lib/positions";
import { ROLE_LABELS } from "@/lib/nav";
import { ecoLabel } from "@/lib/eco/labels";
import { liveTrips } from "@/lib/live";
import { CREATE_ROLES, canCreate } from "./create";
import { listsFor } from "./list";
import { prodFilter } from "@/lib/production";
import { myBrigades } from "@/lib/brigades";
import { SUPPLY_LABEL, totalPlanned } from "@/lib/supply";
import { unitLabel, unitTotals, soleUnit, type UnitRow } from "@/lib/unit";
import type { MobileUser } from "./auth";
import type { Role } from "@/generated/prisma";

/**
 * Mobil ilova bosh ekrani — rolga qarab. Server nimani ko'rsatishni hal qiladi,
 * ilova faqat chizadi: shunda yangi ko'rsatkich qo'shish uchun ilovani qayta chiqarish shart emas.
 */
export type Tone = "brand" | "success" | "warning" | "danger" | "info";
/** `icon` — Ionicons nomi; ilova kartaning yuqorisida chizadi. */
/**
 * `filters` — karta ostidagi davr tugmalari (masalan Tushum: bugun / hafta / oy / yil).
 * Bosilganda ilova bosh sahifani `?<param>=<key>` bilan qayta so'raydi; raqamni server hisoblaydi.
 */
export type CardFilter = { key: string; label: string; active: boolean };
export type HomeCard = { key: string; label: string; value: string; hint?: string; tone?: Tone; icon?: string; filterParam?: string; filters?: CardFilter[];
  /** Kalendardan tanlangan oraliq ("custom" filtr) — ilova kalendarini shu kunlar bilan ochadi. `YYYY-MM-DD`. */
  range?: { from: string; to: string } | null };
/** Bosh sahifa so'rovidagi ixtiyoriy parametrlar (karta filtrlari). */
export type HomeOpts = { revenue?: string; from?: string; to?: string };

/** Direktor "Tushum" kartasi davrlari. */
const REVENUE_PERIODS = [
  { key: "day", label: "Bugun" }, { key: "week", label: "Hafta" }, { key: "month", label: "Oy" }, { key: "year", label: "Yil" },
] as const;
type RevenuePeriod = (typeof REVENUE_PERIODS)[number]["key"] | "custom";

const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
const parseYmd = (v?: string) => (v && ymdRe.test(v) ? new Date(`${v}T00:00:00`) : null);
const fmtYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Davr va undan oldingi teng davr (taqqoslash uchun). Hafta dushanbadan. */
function revenueRange(p: RevenuePeriod) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const to = new Date(t); to.setDate(to.getDate() + 1);
  let from: Date, prevFrom: Date, prevTo: Date;
  if (p === "day") { from = t; prevTo = t; prevFrom = new Date(t); prevFrom.setDate(t.getDate() - 1); }
  else if (p === "week") {
    from = new Date(t); from.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    prevFrom = new Date(from); prevFrom.setDate(from.getDate() - 7);
    prevTo = new Date(prevFrom); prevTo.setDate(prevFrom.getDate() + (to.getTime() - from.getTime()) / 86400000);
  } else if (p === "year") {
    from = new Date(t.getFullYear(), 0, 1); prevFrom = new Date(t.getFullYear() - 1, 0, 1);
    prevTo = new Date(t.getFullYear() - 1, t.getMonth(), t.getDate() + 1);
  } else {
    from = new Date(t.getFullYear(), t.getMonth(), 1); prevFrom = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    prevTo = new Date(t.getFullYear(), t.getMonth() - 1, t.getDate() + 1);
  }
  return { from, to, prevFrom, prevTo };
}
/** `open` — bosilganda ochiladigan ro'yxat kaliti (kartochka emas): bo'lim `target` siz bo'lganda ishlatiladi. */
export type HomeRow = { id: string; title: string; subtitle?: string; right?: string; status?: string; tone?: Tone; open?: string };
/** `target` — qator bosilganda ochiladigan kartochka turi (`/api/mobile/detail?key=...`). Bo'lmasa qator bosilmaydi. */
/** `kind: "list"` — ro'yxatni ochadi, `kind: "new"` — yangi hujjat formasini. */
export type QuickAction = { key: string; label: string; icon: string; kind: "list" | "new" };
/** `icon` — `target` yo'q (hech qayerga o'tmaydigan) bo'limlar uchun ma'noli belgi; bo'lmasa doira. */
/**
 * Bo'lim diagrammasi (ixtiyoriy) — ilova qatorlar o'rniga/ustiga chizadi:
 *   · `progress` — har ko'rsatkich uchun plan/fakt chizig'i va raqamlari (Direktor nazorati);
 *   · `columns` — oylar bo'yicha guruhli ustunlar (tushum / foyda / xarajat).
 * Eski ilova `chart` ni bilmaydi va oddiy `rows` ni chizaveradi — shuning uchun rows ham to'ldiriladi.
 */
export type SectionChart =
  | { kind: "progress"; items: { label: string; pct: number | null; fact: string; plan: string | null; tone: Tone; invert?: boolean; open?: string }[] }
  | { kind: "columns"; series: { key: string; label: string; tone: Tone }[]; groups: { label: string; values: number[]; texts: string[] }[] };
export type HomeSection = { title: string; empty: string; rows: HomeRow[]; target?: string; icon?: string; chart?: SectionChart };
export type MobileHome = {
  role: Role;
  roleLabel: string;
  fullName: string;
  /** Rolning asosiy ro'yxati — ilovadagi ikkinchi tab shuni ochadi. */
  list: { key: string; title: string };
  /** Shu rol yangi hujjat ocha olsa — "+" tugmasi uchun; aks holda null. */
  create: { key: string; label: string } | null;
  /** "Tezkor amallar" katakchalari — rol kira oladigan ro'yxatlar va yangi hujjat. */
  quick: QuickAction[];
  cards: HomeCard[];
  sections: HomeSection[];
  /**
   * Yo'ldagi mashinalar — ilova bosh ekranda xaritada ko'rsatadi.
   * Kim nimani ko'rishi serverda hal bo'ladi (`lib/eco/visibility.ts`): sotuvchiga faqat
   * o'zi ochgan zayavkalarning reyslari. Bo'sh bo'lsa ilova xaritani chizmaydi.
   */
  live: LiveTruck[];
};

/** Xaritadagi bitta mashina. `km` — reys boshidan beri GPS izi bo'yicha yurilgan yo'l. */
export type LiveTruck = {
  ref: string;
  /** ERP reysining id'si — qator bosilganda kartochka shu bo'yicha ochiladi. Topilmasa null. */
  tripId: string | null;
  lat: number;
  lng: number;
  plate: string;
  driver: string;
  customer: string;
  status: string;
  km: number;
  etaMin: number | null;
};

/** Har bir rolning "ishchi" ro'yxati — `lib/mobile/list.ts` dagi kalit. */
export const ROLE_LIST: Record<Role, { key: string; title: string }> = {
  DIRECTOR: { key: "approvals", title: "Tasdiqlar" },
  SALES: { key: "orders", title: "Zayavkalar" },
  PRODUCTION: { key: "production", title: "Zameslar" },
  SUPERVISOR: { key: "tasks", title: "Topshiriqlar" },
  LOGISTICS: { key: "trips", title: "Reyslar" },
  WAREHOUSE: { key: "stock", title: "Sklad" },
  PROCUREMENT: { key: "receipts", title: "Kirimlar" },
  ACCOUNTING: { key: "invoices", title: "Schyotlar" },
  FINANCE: { key: "cashflow", title: "Kirim-chiqim" },
  HR: { key: "employees", title: "Xodimlar" },
  CASHIER: { key: "payments", title: "To'lovlar" },
  DRIVER: { key: "trips", title: "Mening reyslarim" },
  BRIGADIER: { key: "tasks", title: "Topshiriqlarim" },
};

/** Tezkor amal katakchasi ikonlari (ilovadagi `design/icons.tsx` nomlari). */
const LIST_ICON: Record<string, string> = {
  orders: "document-text", sales: "trending-up", customers: "users", leads: "inbox", invoices: "receipt",
  production: "cube", recipes: "droplets", tasks: "checkbox", brigades: "hard-hat",
  trips: "bus", drivers: "id-card",
  stock: "layers", snabjeniye: "shopping-cart", supply: "clipboard-list", receipts: "download", suppliers: "store",
  cashflow: "swap-vertical", payments: "cash", employees: "people",
  approvals: "circle-check", activity: "activity",
};
const SUPPLY_TONE: Record<string, Tone> = { NEW: "info", PRICED: "warning", APPROVED: "warning", FUNDED: "brand", RECEIVED: "success", REJECTED: "danger" };

/** Bosh ekran uchun ta'minot zayavkalari qatori — bosqich bo'yicha. */
async function supplySection(title: string, empty: string, status: ("NEW" | "PRICED" | "APPROVED" | "FUNDED")[]): Promise<HomeSection> {
  const rows = await db.supplyRequest.findMany({ where: { status: { in: status } }, orderBy: { date: "asc" }, take: 10, include: { items: true, warehouse: true, supplier: true } });
  return {
    title, empty, target: "supply",
    rows: rows.map((r) => ({
      id: r.id, title: `${r.docNo} · ${r.warehouse.name}${r.recheck ? " · qayta tasdiq" : ""}`,
      subtitle: `${day(r.date)} · ${r.items.length} qator${r.supplier ? ` · ${r.supplier.name}` : ""}`,
      right: r.status === "NEW" ? `${r.items.length} nom` : money(totalPlanned(r)),
      status: SUPPLY_LABEL[r.status], tone: SUPPLY_TONE[r.status],
    })),
  };
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const startOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; };
const sum = (n: unknown) => Number(n ?? 0);
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const short = (n: number) =>
  n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(1)} mlrd` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)} mln` : n >= 1_000 ? `${Math.round(n / 1_000)} ming` : String(Math.round(n));
/** Miqdor mahsulotning o'z birligida: beton m³, ustun/blok dona. */
const num = (n: number) => n.toFixed(n % 1 ? 1 : 0);
const inUnit = (n: number, unit: string | null) => (unit ? `${num(n)} ${unitLabel(unit)}` : num(n));
/** Aralash birlikli hajm: "12 m³ · 500 dona" — m³ bilan dona qo'shilmaydi. */
const totalsText = (rows: UnitRow[]) => {
  const t = unitTotals(rows);
  return t.length ? t.map((x) => inUnit(x.qty, x.unit)).join(" · ") : "0";
};
/** Reys miqdori zayavkadagi mahsulot birligida (aralash bo'lsa — birliksiz son). */
const tripQty = (t: { qtyM3: unknown; order: { items: { qtyM3: UnitRow["qty"]; product: { unit: string } }[] } }) =>
  inUnit(sum(t.qtyM3), soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))));
const time = (d: Date) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const day = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

const ORDER_TONE: Record<string, Tone> = { DRAFT: "info", BLOCKED: "danger", CONFIRMED: "brand", IN_PRODUCTION: "warning", DELIVERED: "success", CLOSED: "success", CANCELLED: "danger" };
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };

/**
 * Direktor bosh sahifasi — vebdagi Egasi dashbordi (`ownerDashboard()`). Og'ir (o'nlab so'rov), ilova
 * esa bosh ekranni 30 s da yangilaydi — shuning uchun bir daqiqa keshda turadi (hamma direktorlar uchun bitta).
 */
let ownerCache: { at: number; data: Promise<Awaited<ReturnType<typeof ownerDashboard>>> } | null = null;
function ownerCached() {
  if (!ownerCache || Date.now() - ownerCache.at > 60_000) {
    const data = ownerDashboard();
    ownerCache = { at: Date.now(), data };
    data.catch(() => { ownerCache = null; });
  }
  return ownerCache.data;
}

/** Vebdagi vazifa havolasi → ilovadagi ro'yxat. Mos ro'yxat bo'lmasa qator bosilmaydi. */
function taskList(href: string): string | undefined {
  const path = href.split("?")[0];
  if (path.startsWith("/receipts")) return "receipts";
  if (path.startsWith("/invoices")) return "invoices";
  if (path.startsWith("/orders")) return "orders";
  if (path.startsWith("/drivers")) return "drivers";
  if (path.startsWith("/stock")) return "stock";
  if (path.includes("mijozlar")) return "customers";
  return undefined;
}

/** Kassa va bank hisoblarining hozirgi qoldig'i. */
async function cashBalance() {
  const [pay, tx] = await Promise.all([
    db.payment.aggregate({ _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["type"], _sum: { amount: true } }),
  ]);
  const income = tx.find((t) => t.type === "INCOME")?._sum.amount;
  const expense = tx.find((t) => t.type === "EXPENSE")?._sum.amount;
  return sum(pay._sum.amount) + sum(income) - sum(expense);
}

export async function mobileHome(user: MobileUser, opts: HomeOpts = {}): Promise<MobileHome> {
  const list = ROLE_LIST[user.role];
  // "+" tugmasi — rolning asosiy hujjati; qolgan formalar va ro'yxatlar "Tezkor amallar" to'rida.
  // To'r cheklanmaydi: vebda ko'ringan har bir bo'lim ilovada ham turadi (`lib/mobile/list.ts` — `ACCESS`).
  const creatables = Object.keys(CREATE_ROLES).filter((k) => canCreate(user, k));
  const creatable = creatables.find((k) => k === list.key) ?? creatables[0];
  const quick: QuickAction[] = [
    ...creatables.map((k) => ({ key: k, label: CREATE_ROLES[k].label, icon: "add", kind: "new" as const })),
    ...listsFor(user.role).filter((l) => l.key !== list.key).map((l) => ({ key: l.key, label: l.title, icon: LIST_ICON[l.key] ?? "folder", kind: "list" as const })),
  ];
  const base = {
    role: user.role, roleLabel: ROLE_LABELS[user.role], fullName: user.fullName, list,
    create: creatable ? { key: creatable, label: CREATE_ROLES[creatable].label } : null,
    quick,
  };
  const cards: HomeCard[] = [];
  const sections: HomeSection[] = [];
  const today = startOfToday();

  switch (user.role) {
    case "DIRECTOR": {
      // Vebdagi direktor bosh sahifasi (Egasi dashbordi, TZ v2.0) bilan bitta manba — `ownerDashboard()`.
      // Ilova raqamni o'zi hisoblamaydi: vebda nima bo'lsa, telefonda ham shu.
      const [d, trips] = await Promise.all([
        ownerCached(),
        db.trip.findMany({ where: { status: { in: ["LOADED", "ON_ROAD"] } }, orderBy: { createdAt: "desc" }, take: 8, include: { order: { include: { customer: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } }, driver: true, vehicle: true } }),
      ]);
      const S = d.summary, L = d.levels;
      const tone = (l: string): Tone => (l === "crit" ? "danger" : l === "warn" ? "warning" : "success");
      const pctTxt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v)}%`);
      // Tushum — tanlangan davr bo'yicha (oy — egasi dashbordidagi raqam, plan bilan)
      // Kalendardan oraliq: ?revenue=custom&from=YYYY-MM-DD&to=YYYY-MM-DD (to — shu kun ham kiradi, 400 kungacha)
      const cFrom = parseYmd(opts.from), cToIn = parseYmd(opts.to);
      const customOk = opts.revenue === "custom" && cFrom && cToIn && cToIn >= cFrom && (cToIn.getTime() - cFrom.getTime()) / 86400000 <= 400;
      const period: RevenuePeriod = customOk ? "custom" : ((REVENUE_PERIODS.some((p) => p.key === opts.revenue) ? opts.revenue : "month") as RevenuePeriod);
      const periodLabel = period === "custom" ? `${dm(cFrom!)} — ${dm(cToIn!)}` : REVENUE_PERIODS.find((p) => p.key === period)!.label.toLowerCase();
      let revenueCard: HomeCard;
      if (period === "custom") {
        const to = new Date(cToIn!); to.setDate(to.getDate() + 1);
        const days = Math.round((to.getTime() - cFrom!.getTime()) / 86400000);
        const prevFrom = new Date(cFrom!); prevFrom.setDate(prevFrom.getDate() - days);
        const [cur, prev] = await Promise.all([loadSales(cFrom!, to), loadSales(prevFrom, cFrom!)]);
        const a = cur.reduce((x, y) => x + y.revenue, 0), b = prev.reduce((x, y) => x + y.revenue, 0);
        const delta = b > 0 ? ((a - b) / b) * 100 : null;
        revenueCard = {
          key: "revenue", label: `Tushum (${periodLabel})`, value: short(a),
          hint: `${new Set(cur.map((x) => x.orderId)).size} ta zayavka · ${days} kun${delta == null ? "" : ` · oldingi ${days} kundan ${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}%`}`,
          tone: delta != null && delta < 0 ? "warning" : "success", icon: "trending-up",
        };
      } else if (period === "month") {
        revenueCard = { key: "revenue", label: "Tushum (oy)", value: short(S.revenue.month), hint: `bugun ${short(S.revenue.today)}${S.revenue.plan ? ` · plan ${pctTxt(S.revenue.pct)}` : ""}`, tone: tone(L.revenue), icon: "trending-up" };
      } else {
        const r = revenueRange(period);
        const [cur, prev] = await Promise.all([loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo)]);
        const a = cur.reduce((x, y) => x + y.revenue, 0), b = prev.reduce((x, y) => x + y.revenue, 0);
        const delta = b > 0 ? ((a - b) / b) * 100 : null;
        const prevName = period === "day" ? "kechagidan" : period === "week" ? "o'tgan haftadan" : "o'tgan yildan";
        revenueCard = {
          key: "revenue", label: `Tushum (${periodLabel})`, value: short(a),
          hint: delta == null ? `${new Set(cur.map((x) => x.orderId)).size} ta zayavka` : `${prevName} ${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}%`,
          tone: delta != null && delta < 0 ? "warning" : "success", icon: "trending-up",
        };
      }
      revenueCard.filterParam = "revenue";
      revenueCard.filters = [
        ...REVENUE_PERIODS.map((p) => ({ key: p.key, label: p.label, active: p.key === period })),
        // Kalendar — ilova oraliq tanlaydi; tanlangan bo'lsa yozuvi oraliqning o'zi
        { key: "custom", label: period === "custom" ? periodLabel : "Kalendar", active: period === "custom" },
      ];
      revenueCard.range = period === "custom" ? { from: fmtYmd(cFrom!), to: fmtYmd(cToIn!) } : null;
      cards.push(
        revenueCard,
        { key: "profit", label: "Sof foyda", value: short(S.profit.month), hint: `prognoz ${short(S.profit.forecast)}`, tone: tone(L.profit), icon: "banknote" },
        { key: "expenses", label: "Xarajatlar", value: short(S.expenses.month), hint: S.expenses.plan ? `byudjet ${short(S.expenses.plan)}` : `tushumning ${pctTxt(S.expenses.ratio)}`, tone: tone(L.expenses), icon: "wallet" },
        { key: "cash", label: "Pul", value: short(S.cash.total), hint: `kassa ${short(S.cash.cash)} · bank ${short(S.cash.bank)}`, tone: tone(L.cash), icon: "landmark" },
        { key: "receivable", label: "Debitorka", value: short(S.receivable.total), hint: S.receivable.overdue ? `muddati o'tgan ${short(S.receivable.overdue)}` : `${S.receivable.debtors} ta qarzdor`, tone: tone(L.receivable), icon: "receipt" },
        { key: "problems", label: "Muammolar", value: String(d.problems.length), hint: d.problems.length ? "qaror kerak" : "hammasi joyida", tone: d.problems.length ? (d.problems.some((p) => p.level === "crit") ? "danger" : "warning") : "success", icon: "triangle-alert" },
        { key: "production", label: "Ishlab chiqarish", value: `${num(S.production.concreteMonth)} m³`, hint: S.production.concretePlan ? `plan ${num(S.production.concretePlan)} m³ · bugun ${num(S.production.concreteToday)}` : `bugun ${num(S.production.concreteToday)} m³`, tone: tone(L.production), icon: "factory" },
        { key: "shipment", label: "Otgruzka", value: `${num(S.shipment.month)} m³`, hint: `bugun ${num(S.shipment.today)} m³ · ${S.shipment.tripsToday} reys`, tone: tone(L.transport), icon: "truck" },
      );
      const decisionsSection: HomeSection = {
        title: "Egasi qarori kerak", empty: "Qaror talab qiladigan masala yo'q", icon: "triangle-alert",
        rows: d.decisions.slice(0, 8).map((x) => ({ id: `dec-${x.key}`, title: x.problem, subtitle: `${x.decision} · ${x.owner} · ${x.due}`, right: x.amount ? short(Math.abs(x.amount)) : undefined, tone: tone(x.level), open: taskList(x.href) })),
      };
      const val = (v: number, unit: string) => (unit === "so'm" ? short(v) : `${num(v)} ${unit}`);
      sections.push(
        // Direktor nazorati — diagramma (plan/fakt chizig'i) va raqamlar; pastida egasi qarori
        {
          title: "Direktor nazorati — plan / fakt", empty: "", icon: "square-check",
          rows: d.directorControl.map((r, i) => ({
            id: `ctl-${i}`, title: r.label,
            subtitle: `plan ${r.plan == null ? "—" : val(r.plan, r.unit)} · fakt ${val(r.fact, r.unit)}`,
            right: r.pct == null ? undefined : pctTxt(r.pct), tone: tone(r.level), open: taskList(r.href),
          })),
          chart: {
            kind: "progress",
            items: d.directorControl.map((r) => ({
              label: r.label, pct: r.pct == null ? null : Math.round(r.pct), fact: val(r.fact, r.unit), plan: r.plan == null ? null : val(r.plan, r.unit),
              tone: tone(r.level), invert: !!(r as { invert?: boolean }).invert, open: taskList(r.href),
            })),
          },
        },
        decisionsSection,
        {
          title: "Dinamika — 3 oy", empty: "", icon: "chart-column",
          rows: d.trend.map((t) => ({ id: `tr-${t.key}`, title: t.label, subtitle: `tushum ${short(t.revenue)} · foyda ${short(t.profit)} · xarajat ${short(t.expenses)}` })),
          chart: {
            kind: "columns",
            series: [{ key: "revenue", label: "Tushum", tone: "brand" }, { key: "profit", label: "Foyda", tone: "success" }, { key: "expenses", label: "Xarajat", tone: "danger" }],
            groups: d.trend.map((t) => ({ label: t.label, values: [t.revenue, Math.max(0, t.profit), t.expenses], texts: [short(t.revenue), short(t.profit), short(t.expenses)] })),
          },
        },
        // "Bugungi holat" bosilsa — barcha xodimlarning bugungi ishlari (`activity` ro'yxati)
        { title: "Kunlik hisobot", empty: "", icon: "file-text", rows: [{ id: "report", title: "Bugungi holat", subtitle: d.reportText, open: "activity" }] },
        { title: "Yo'ldagi reyslar", empty: "Yo'lda reys yo'q", target: "trips", rows: trips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.driver.fullName} · ${t.vehicle.plate}`, right: tripQty(t), status: t.status, tone: TRIP_TONE[t.status] })) },
      );
      break;
    }

    case "SALES": {
      const [mine, blocked, monthItems, recent] = await Promise.all([
        db.order.count({ where: { createdById: user.id, date: { gte: today }, status: { not: "CANCELLED" } } }),
        db.order.count({ where: { status: "BLOCKED" } }),
        db.orderItem.findMany({ where: { order: { createdById: user.id, date: { gte: startOfMonth() }, status: { not: "CANCELLED" } } }, select: { qtyM3: true, price: true, product: { select: { unit: true } } } }),
        db.order.findMany({ where: { createdById: user.id }, orderBy: { date: "desc" }, take: 10, include: { customer: true, items: { include: { product: true } } } }),
      ]);
      cards.push(
        { key: "mine", label: "Bugungi zayavkam", value: String(mine), tone: "brand", icon: "document-text" },
        { key: "m3", label: "Oylik hajm", value: totalsText(monthItems.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))), tone: "info", icon: "cube" },
        { key: "sum", label: "Oylik summa", value: short(monthItems.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0)), hint: "so'm", tone: "success", icon: "cash" },
        { key: "blocked", label: "Bloklangan", value: String(blocked), tone: blocked ? "danger" : "success", icon: "lock-closed" },
      );
      // Vebdagi "Zayavkalar" sahifasi tepasidagi ikki karta: ta'minot tasdig'i va sayt arizalari
      const [supplyWait, newLeads, leadRows] = await Promise.all([
        db.supplyRequest.count({ where: { status: "PRICED" } }),
        db.lead.count({ where: { status: "NEW" } }),
        db.lead.findMany({ where: { status: "NEW" }, orderBy: { createdAt: "desc" }, take: 5, include: { product: { select: { name: true } } } }),
      ]);
      if (supplyWait) cards.push({ key: "supply", label: "Ta'minot tasdig'i", value: String(supplyWait), hint: "sizni kutmoqda", tone: "warning", icon: "clipboard-list" });
      if (newLeads) cards.push({ key: "leads", label: "Yangi ariza", value: String(newLeads), hint: "saytdan", tone: "brand", icon: "inbox" });
      if (supplyWait) sections.push(await supplySection("Ta'minot — tasdiqingizni kutmoqda", "", ["PRICED"]));
      if (newLeads) sections.push({ title: "Saytdan yangi arizalar", empty: "", target: "leads", rows: leadRows.map((l) => ({ id: l.id, title: `${l.name} · ${l.phone}`, subtitle: `${day(l.createdAt)}${l.product ? ` · ${l.product.name}` : ""}${l.address ? ` · ${l.address}` : ""}`, status: "Yangi", tone: "brand" as Tone })) });
      sections.push({ title: "Mening zayavkalarim", empty: "Hali zayavka kiritmagansiz", target: "orders", rows: recent.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer.name}`, subtitle: `${day(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""} · ${o.deliveryAddress}`, right: totalsText(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))), status: o.status, tone: ORDER_TONE[o.status] })) });
      break;
    }

    case "PRODUCTION": {
      const [batches, inProd, tasks, openTasks, prodOrders] = await Promise.all([
        db.productionBatch.findMany({ where: { date: { gte: today } }, orderBy: { date: "desc" }, take: 10, include: { product: true, order: { include: { customer: true } } } }),
        db.order.count({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } } }),
        db.brigadeTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } }),
        db.brigadeTask.findMany({ where: { status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, take: 10, include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } } }),
        // "Zayavkalar" ro'yxatidagi filtrlar bilan bir xil sanoq — `lib/production.ts`
        db.order.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { deliveryDate: "asc" }, take: 400, select: { status: true, deliveryDate: true, isUrgent: true, items: { select: { task: { select: { status: true } } } } } }),
      ]);
      const count = (key: string) => prodOrders.filter(prodFilter(key).test).length;
      const waiting = count("unassigned");
      const soon = count("soon");
      cards.push(
        { key: "today", label: "Bugungi zames", value: totalsText(batches.map((b) => ({ unit: b.product.unit, qty: b.qtyM3 }))), hint: `${batches.length} partiya`, tone: "brand", icon: "today" },
        { key: "unassigned", label: "Brigada kutayotgan", value: String(waiting), hint: "zayavka", tone: waiting ? "warning" : "success", icon: "hammer" },
        { key: "soon", label: "Muddati yaqin", value: String(soon), hint: "≤ 2 kun", tone: soon ? "danger" : "success", icon: "alarm" },
        { key: "inprod", label: "Ishlab chiqarishda", value: String(inProd), hint: "zayavka", tone: "warning", icon: "construct" },
        { key: "tasks", label: "Ochiq topshiriq", value: String(tasks), tone: tasks ? "info" : "success", icon: "list" },
      );
      sections.push(
        { title: "Ochiq topshiriqlar", empty: "Topshiriq yo'q", rows: openTasks.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.brigade.name}`, subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`, right: inUnit(sum(t.qty) - sum(t.doneQty), t.orderItem.product.unit), status: t.status, tone: t.status === "NEW" ? "info" : "warning" })) },
        { title: "Bugungi zameslar", empty: "Bugun zames yo'q", target: "production", rows: batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: b.order ? b.order.customer.name : "Omborga", right: inUnit(sum(b.qtyM3), b.product.unit), status: `${b.shift}-smena` })) },
      );
      break;
    }

    case "SUPERVISOR": {
      const [openTasks, overdue, todayProgress, batches] = await Promise.all([
        db.brigadeTask.findMany({ where: { status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, take: 20, include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } } }),
        db.brigadeTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] }, dueDate: { lt: today } } }),
        db.taskProgress.findMany({ where: { date: { gte: today } }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
        db.productionBatch.findMany({ where: { date: { gte: today } }, orderBy: { date: "desc" }, take: 10, include: { product: true, order: { include: { customer: true } } } }),
      ]);
      const leftRows = openTasks.map((t) => ({ unit: t.orderItem.product.unit, qty: sum(t.qty) - sum(t.doneQty) }));
      cards.push(
        { key: "tasks", label: "Ochiq topshiriq", value: String(openTasks.length), icon: "list", tone: openTasks.length ? "brand" : "success" },
        { key: "left", label: "Qolgan hajm", value: totalsText(leftRows), icon: "cube", tone: "info" },
        { key: "overdue", label: "Kechikkan", value: String(overdue), hint: overdue ? "muddati o'tgan" : undefined, icon: "alarm", tone: overdue ? "danger" : "success" },
        { key: "today", label: "Bugun bajarildi", value: totalsText(todayProgress.map((p) => ({ unit: p.task.orderItem.product.unit, qty: p.qty }))), icon: "checkmark-done", tone: "success" },
      );
      sections.push(
        { title: "Ochiq topshiriqlar", empty: "Topshiriq yo'q", target: "tasks", rows: openTasks.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.brigade.name}`, subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`, right: inUnit(sum(t.qty) - sum(t.doneQty), t.orderItem.product.unit), status: t.status, tone: t.dueDate < today ? "danger" as Tone : t.status === "NEW" ? "info" as Tone : "warning" as Tone })) },
        { title: "Bugungi zameslar", empty: "Bugun zames yo'q", target: "production", rows: batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: b.order ? b.order.customer.name : "Omborga", right: inUnit(sum(b.qtyM3), b.product.unit), status: `${b.shift}-smena` })) },
      );
      break;
    }

    case "LOGISTICS": {
      // Vebdagi logistika paneli bilan bir xil raqamlar — bitta `logisticsDashboard()` dan (TZ 3-bo'lim)
      const { logisticsDashboard } = await import("@/lib/logistics-dashboard");
      const { TRIP_PHASE, minutesLabel } = await import("@/lib/logistics");
      const d = await logisticsDashboard();
      const k = d.kpi;
      cards.push(
        { key: "today", label: "Bugungi reyslar", value: String(k.trips), hint: `${k.done} yakunlandi`, tone: "brand", icon: "today" },
        { key: "onroad", label: "Yo'ldagi transport", value: String(k.onRoad), hint: `${k.freeVehicles} bo'sh / ${k.totalVehicles}`, tone: "info", icon: "navigate" },
        { key: "waiting", label: "Kutayotgan buyurtma", value: String(k.waitingOrders), hint: k.waitingQty ? `${k.waitingQty} biriktirilmagan` : undefined, tone: k.waitingOrders ? "warning" : "success", icon: "calendar" },
        { key: "late", label: "Kechikmoqda", value: String(k.late), tone: k.late ? "danger" : "success", icon: "alarm" },
        { key: "m3", label: "Bugungi beton", value: `${k.concreteM3} m³`, hint: `o'rt. ${minutesLabel(k.avgDeliveryMin)}`, tone: "success", icon: "cube" },
        { key: "cost", label: "Transport xarajati", value: money(k.cost), tone: "info", icon: "wallet" },
      );
      if (d.alerts.length) {
        sections.push({ title: "Ogohlantirishlar", empty: "", icon: "alert-circle", rows: d.alerts.slice(0, 8).map((a, i) => {
          const tripId = a.href.startsWith("/trips/") && !a.href.includes("new") ? a.href.slice(7) : null;
          return { id: tripId ?? `a${i}`, title: a.title, subtitle: a.text, tone: a.level === "crit" ? "danger" as Tone : "warning" as Tone, ...(tripId ? {} : { open: a.href.includes("orderId") || a.href.startsWith("/orders") ? "orders" : "trips" }) };
        }) });
      }
      const active = d.trips.filter((t) => ["PLANNED", "LOADED", "ON_ROAD"].includes(t.status));
      sections.push({ title: "Faol reyslar", empty: "Faol reys yo'q", target: "trips", rows: active.map((t) => ({
        id: t.id, title: `${t.noteNo} · ${t.customer}`,
        subtitle: `${t.driver} · ${t.plate}${t.fix?.etaMin != null && t.phase === "ON_ROAD" ? ` · ETA ${t.fix.etaMin} daq` : ""}${t.delayMin && t.delayMin > 0 ? ` · +${t.delayMin} daq` : ""}`,
        right: `${t.qty} ${t.unit === "m3" ? "m³" : t.unit}`, status: TRIP_PHASE[t.phase].label,
        tone: t.openIssues ? "danger" as Tone : t.level === "crit" ? "danger" as Tone : t.level === "warn" ? "warning" as Tone : TRIP_TONE[t.status],
      })) });
      const waiting = d.orders.filter((o) => o.remaining > 0.001 && ["CONFIRMED", "PLANNED", "ASSIGNED", "LOADING", "ON_ROAD"].includes(o.status));
      if (waiting.length) sections.push({ title: "Transport kutayotgan buyurtmalar", empty: "", target: "orders", rows: waiting.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer}`, subtitle: `${o.deliveryTime ?? "soatsiz"} · ${o.address}`, right: `${o.remaining} ${o.unit === "m3" ? "m³" : o.unit}`, tone: o.late ? "danger" as Tone : "warning" as Tone })) });
      break;
    }

    case "WAREHOUSE": {
      const [materials, balances, receipts] = await Promise.all([
        db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
        db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
        db.goodsReceipt.findMany({ where: { date: { gte: today } }, include: { supplier: true, items: true } }),
      ]);
      const bal = new Map(balances.map((b) => [b.materialId, sum(b._sum.qty)]));
      const low = materials.filter((m) => (bal.get(m.id) ?? 0) < sum(m.minStock));
      cards.push(
        { key: "low", label: "Kam qolgan", value: String(low.length), hint: low.length ? "buyurtma bering" : "hammasi yetarli", tone: low.length ? "danger" : "success", icon: "alert-circle" },
        { key: "kinds", label: "Xomashyo turi", value: String(materials.length), tone: "info", icon: "layers" },
        { key: "receipts", label: "Bugungi kirim", value: String(receipts.length), hint: "hujjat", tone: "brand", icon: "download" },
      );
      // Sklad ham snabjeniye amallarini bajaradi (`lib/supply-actions.ts` izohi): narx va qabul kutayotganlar shu yerda
      const [needPrice, needReceive] = await Promise.all([db.supplyRequest.count({ where: { status: "NEW" } }), db.supplyRequest.count({ where: { status: "FUNDED" } })]);
      cards.push({ key: "supply", label: "Ta'minot navbati", value: String(needPrice + needReceive), hint: needPrice || needReceive ? `${needPrice} narx · ${needReceive} qabul` : "navbat bo'sh", tone: needPrice + needReceive ? "warning" : "success", icon: "clipboard-list" });
      sections.push(
        { title: "Kam qolgan xomashyo", empty: "Hammasi minimumdan yuqori", target: "stock", rows: low.map((m) => ({ id: m.id, title: m.name, subtitle: `Minimum ${sum(m.minStock)} ${m.unit}`, right: `${(bal.get(m.id) ?? 0).toFixed(1)} ${m.unit}`, tone: "danger" })) },
        ...(needReceive ? [await supplySection("Qabul kutilmoqda — pul ajratilgan", "", ["FUNDED"])] : []),
        ...(needPrice ? [await supplySection("Narx kutayotgan so'rovlar", "", ["NEW"])] : []),
        { title: "Bugungi kirimlar", empty: "Bugun kirim yo'q", target: "receipts", rows: receipts.map((r) => ({ id: r.id, title: `${r.docNo} · ${r.supplier.name}`, subtitle: `${r.items.length} qator · ${time(r.date)}`, right: money(r.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0)) })) },
      );
      break;
    }

    case "PROCUREMENT": {
      const [monthReceipts, suppliers, recent] = await Promise.all([
        db.goodsReceipt.findMany({ where: { date: { gte: startOfMonth() } }, include: { items: true } }),
        db.supplier.count({ where: { isActive: true } }),
        db.goodsReceipt.findMany({ orderBy: { date: "desc" }, take: 12, include: { supplier: true, items: true } }),
      ]);
      const monthSum = monthReceipts.reduce((s, r) => s + r.items.reduce((x, i) => x + sum(i.qty) * sum(i.price), 0), 0);
      cards.push(
        { key: "month", label: "Oylik xarid", value: short(monthSum), hint: "so'm", tone: "brand", icon: "cart" },
        { key: "docs", label: "Oylik hujjat", value: String(monthReceipts.length), tone: "info", icon: "documents" },
        { key: "suppliers", label: "Yetkazuvchi", value: String(suppliers), tone: "success", icon: "people" },
      );
      const [needPrice, needReceive] = await Promise.all([db.supplyRequest.count({ where: { status: "NEW" } }), db.supplyRequest.count({ where: { status: "FUNDED" } })]);
      cards.push({ key: "supply", label: "Narx kutmoqda", value: String(needPrice), hint: needReceive ? `${needReceive} ta qabul kutmoqda` : undefined, tone: needPrice ? "warning" : "success", icon: "clipboard-list" });
      sections.push(
        await supplySection("Narx qo'yish kerak", "Narx kutayotgan so'rov yo'q", ["NEW"]),
        ...(needReceive ? [await supplySection("Qabul kutilmoqda — pul ajratilgan", "", ["FUNDED"])] : []),
        { title: "So'nggi kirimlar", empty: "Kirim yo'q", target: "receipts", rows: recent.map((r) => ({ id: r.id, title: `${r.docNo} · ${r.supplier.name}`, subtitle: `${day(r.date)} · ${r.items.length} qator`, right: money(r.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0)) })) },
      );
      break;
    }

    case "ACCOUNTING": {
      const [open, todayPay, invoices] = await Promise.all([
        db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { customer: true, payments: true } }),
        db.payment.aggregate({ where: { date: { gte: today } }, _sum: { amount: true }, _count: true }),
        db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: { date: "asc" }, take: 12, include: { customer: true, payments: true } }),
      ]);
      const debt = open.reduce((s, i) => s + sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0), 0);
      cards.push(
        { key: "debt", label: "Qarzdorlik", value: short(debt), hint: "so'm", tone: debt > 0 ? "danger" : "success", icon: "warning" },
        { key: "open", label: "Ochiq schyot", value: String(open.length), tone: "warning", icon: "receipt" },
        { key: "paid", label: "Bugungi to'lov", value: short(sum(todayPay._sum.amount)), hint: `${todayPay._count} ta`, tone: "success", icon: "checkmark-circle" },
      );
      const fundWait = await db.supplyRequest.count({ where: { status: "APPROVED" } });
      if (fundWait) {
        cards.push({ key: "supply", label: "Ta'minot to'lovi", value: String(fundWait), hint: "tasdiq kutmoqda", tone: "warning", icon: "clipboard-list" });
        sections.push(await supplySection("Ta'minot to'lovlari — tasdiq kutilmoqda", "", ["APPROVED"]));
      }
      sections.push({ title: "Ochiq schyotlar", empty: "Ochiq schyot yo'q", target: "invoices", rows: invoices.map((i) => { const left = sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0); return { id: i.id, title: `${i.invoiceNo} · ${i.customer.name}`, subtitle: `${day(i.date)} · jami ${money(sum(i.amount))}`, right: money(left), status: i.status, tone: i.status === "PARTIAL" ? "warning" : "danger" }; }) });
      break;
    }

    case "FINANCE": {
      const [balance, inToday, outToday, recent] = await Promise.all([
        cashBalance(),
        db.payment.aggregate({ where: { date: { gte: today } }, _sum: { amount: true } }),
        db.cashTransaction.aggregate({ where: { date: { gte: today }, type: "EXPENSE" }, _sum: { amount: true } }),
        db.cashTransaction.findMany({ orderBy: { date: "desc" }, take: 12, include: { cashAccount: true } }),
      ]);
      cards.push(
        { key: "balance", label: "Kassa qoldig'i", value: short(balance), hint: "so'm", tone: balance >= 0 ? "success" : "danger", icon: "wallet" },
        { key: "in", label: "Bugungi kirim", value: short(sum(inToday._sum.amount)), tone: "brand", icon: "arrow-down-circle" },
        { key: "out", label: "Bugungi chiqim", value: short(sum(outToday._sum.amount)), tone: "warning", icon: "arrow-up-circle" },
      );
      // Vebdagi Kirim-Chiqim tepasidagi "Ta'minot to'lovlari" kartasi
      const fundWait = await db.supplyRequest.count({ where: { status: "APPROVED" } });
      cards.push({ key: "supply", label: "Ta'minot to'lovi", value: String(fundWait), hint: fundWait ? "tasdiq kutmoqda" : "navbat bo'sh", tone: fundWait ? "warning" : "success", icon: "clipboard-list" });
      if (fundWait) sections.push(await supplySection("Ta'minot to'lovlari — tasdiq kutilmoqda", "", ["APPROVED"]));
      sections.push({ title: "So'nggi harakatlar", empty: "Harakat yo'q", target: "cashflow", rows: recent.map((t) => ({ id: t.id, title: `${t.category}${t.counterparty ? ` · ${t.counterparty}` : ""}`, subtitle: `${day(t.date)} · ${t.cashAccount.name}`, right: `${t.type === "EXPENSE" ? "−" : "+"}${money(sum(t.amount))}`, tone: t.type === "EXPENSE" ? "danger" : "success" })) });
      break;
    }

    case "HR": {
      const [active, inactive, drivers, brigades, recent] = await Promise.all([
        db.employee.count({ where: { isActive: true } }),
        db.employee.count({ where: { isActive: false } }),
        db.employee.count({ where: { isActive: true, position: { in: await driverPositionNames() } } }),
        db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { leader: true, tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } }, select: { id: true } } } }),
        db.employee.findMany({ orderBy: { createdAt: "desc" }, take: 12, include: { brigades: { where: { isActive: true }, select: { name: true } } } }),
      ]);
      // Brigadirsiz brigada — topshiriqni kim boshqarishi noma'lum, shuning uchun ogohlantiriladi
      const headless = brigades.filter((b) => !b.leaderId).length;
      cards.push(
        { key: "active", label: "Faol xodim", value: String(active), tone: "success", icon: "people" },
        { key: "drivers", label: "Haydovchi", value: String(drivers), tone: "brand", icon: "car" },
        { key: "brigadiers", label: "Brigadir", value: String(brigades.length - headless), hint: headless ? `${headless} brigada brigadirsiz` : `${brigades.length} brigada`, tone: headless ? "warning" : "success", icon: "construct" },
        { key: "inactive", label: "Nofaol", value: String(inactive), tone: inactive ? "warning" : "info", icon: "person-remove" },
      );
      sections.push(
        { title: "Brigadalar", empty: "Brigada yo'q", rows: brigades.map((b) => ({ id: b.id, title: b.name, subtitle: b.leader ? `Brigadir: ${b.leader.fullName}${b.leader.phone ? ` · ${b.leader.phone}` : ""}` : "Brigadir biriktirilmagan — Xodimlar kartochkasidan tanlang", right: `${b.tasks.length} topshiriq`, tone: b.leader ? "success" : "warning" })) },
        { title: "So'nggi xodimlar", empty: "Xodim yo'q", target: "employees", rows: recent.map((e) => { const led = e.brigades.map((b) => b.name).join(", "); return { id: e.id, title: e.fullName, subtitle: `${e.position}${led ? ` · ${led} brigadiri` : ""}${e.phone ? ` · ${e.phone}` : ""}`, status: e.isActive ? "Faol" : "Nofaol", tone: e.isActive ? "success" : "danger" }; }) },
      );
      break;
    }

    case "CASHIER": {
      const [todayPay, accounts, recent, balance, openInvoices] = await Promise.all([
        db.payment.aggregate({ where: { date: { gte: today } }, _sum: { amount: true }, _count: true }),
        db.cashAccount.count({ where: { isActive: true } }),
        db.payment.findMany({ where: { date: { gte: today } }, orderBy: { date: "desc" }, take: 15, include: { customer: true, cashAccount: true } }),
        cashBalance(),
        db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: { date: "asc" }, take: 12, include: { customer: true, payments: true } }),
      ]);
      cards.push(
        { key: "today", label: "Bugungi tushum", value: short(sum(todayPay._sum.amount)), hint: "so'm", tone: "success", icon: "today" },
        { key: "count", label: "To'lovlar", value: String(todayPay._count), tone: "brand", icon: "swap-horizontal" },
        { key: "balance", label: "Kassa qoldig'i", value: short(balance), hint: `${accounts} hisob`, tone: "info", icon: "wallet" },
      );
      const fundWait = await db.supplyRequest.count({ where: { status: "APPROVED" } });
      if (fundWait) sections.push(await supplySection("Ta'minot to'lovlari — tasdiq kutilmoqda", "", ["APPROVED"]));
      sections.push(
        // Kassir shu yerdan schyotni ochib to'lovni qabul qiladi
        { title: "Ochiq schyotlar", empty: "Ochiq schyot yo'q", target: "invoices", rows: openInvoices.map((i) => { const left = sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0); return { id: i.id, title: `${i.invoiceNo} · ${i.customer.name}`, subtitle: `${day(i.date)} · jami ${money(sum(i.amount))}`, right: money(left), status: i.status, tone: i.status === "PARTIAL" ? "warning" as Tone : "danger" as Tone }; }) },
        { title: "Bugungi to'lovlar", empty: "Bugun to'lov yo'q", target: "payments", rows: recent.map((p) => ({ id: p.id, title: p.customer.name, subtitle: `${time(p.date)} · ${p.cashAccount.name}`, right: money(sum(p.amount)), tone: "success" })) },
      );
      break;
    }

    // Haydovchi: faqat o'ziga biriktirilgan reyslar. Login xodim kartasiga bog'langan bo'lishi shart.
    case "DRIVER": {
      const me = await db.employee.findFirst({ where: { userId: user.id }, select: { id: true, vehicle: { select: { plate: true } } } });
      if (!me) {
        cards.push({ key: "nolink", label: "Xodim kartasi yo'q", value: "—", hint: "Otdel kadrga ayting", tone: "danger", icon: "alert-circle" });
        break;
      }
      const [todayTrips, active, doneToday, upcoming] = await Promise.all([
        db.trip.findMany({ where: { driverId: me.id, createdAt: { gte: today } }, select: { qtyM3: true, status: true } }),
        db.trip.findMany({ where: { driverId: me.id, status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } }, orderBy: { createdAt: "desc" }, take: 10, include: { order: { include: { customer: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } }, vehicle: true } }),
        db.trip.findMany({ where: { driverId: me.id, status: "DELIVERED", deliveredAt: { gte: today } }, select: { qtyM3: true, order: { select: { items: { select: { qtyM3: true, product: { select: { unit: true } } } } } } } }),
        db.trip.findMany({ where: { driverId: me.id, status: "DELIVERED" }, orderBy: { deliveredAt: "desc" }, take: 8, include: { order: { include: { customer: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } }, vehicle: true } }),
      ]);
      cards.push(
        { key: "active", label: "Ochiq reys", value: String(active.length), hint: me.vehicle?.plate ?? "mashina biriktirilmagan", tone: active.length ? "brand" : "success", icon: "bus" },
        { key: "todayM3", label: "Bugun yetkazdim", value: totalsText(doneToday.map((t) => ({ unit: soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? "m3", qty: t.qtyM3 }))), hint: `${doneToday.length} reys`, tone: "success", icon: "checkmark-done" },
        { key: "todayAll", label: "Bugungi reyslar", value: String(todayTrips.length), tone: "info", icon: "today" },
      );
      sections.push(
        { title: "Ochiq reyslarim", empty: "Ochiq reys yo'q", target: "trips", rows: active.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.order.deliveryAddress} · ${t.vehicle.plate}`, right: tripQty(t), status: t.status, tone: TRIP_TONE[t.status] })) },
        { title: "Yaqinda yetkazganlarim", empty: "Hali yetkazilgan reys yo'q", target: "trips", rows: upcoming.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.deliveredAt ? day(t.deliveredAt) : ""} · ${t.vehicle.plate}`, right: tripQty(t), status: t.status, tone: "success" })) },
      );
      break;
    }

    // Brigadir: faqat O'Z brigadasiga tayinlangan topshiriqlar. Ishlab chiqarish zayavka
    // qatoriga brigada tayinlagan zahoti topshiriq shu yerda paydo bo'ladi.
    case "BRIGADIER": {
      const mine = await myBrigades(user.id);
      if (mine.length === 0) {
        cards.push({ key: "nobrigade", label: "Brigada biriktirilmagan", value: "—", hint: "Ishlab chiqarish yoki Otdel kadrga ayting", tone: "danger", icon: "alert-circle" });
        break;
      }
      const ids = mine.map((b) => b.id);
      const [openTasks, overdue, todayProgress, recent] = await Promise.all([
        db.brigadeTask.findMany({ where: { brigadeId: { in: ids }, status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, take: 20, include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } } }),
        db.brigadeTask.count({ where: { brigadeId: { in: ids }, status: { in: ["NEW", "IN_PROGRESS"] }, dueDate: { lt: today } } }),
        db.taskProgress.findMany({ where: { date: { gte: today }, task: { brigadeId: { in: ids } } }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
        db.brigadeTask.findMany({ where: { brigadeId: { in: ids }, status: "DONE" }, orderBy: { updatedAt: "desc" }, take: 8, include: { order: { include: { customer: true } }, orderItem: { include: { product: true } } } }),
      ]);
      const leftRows = openTasks.map((t) => ({ unit: t.orderItem.product.unit, qty: sum(t.qty) - sum(t.doneQty) }));
      // Hali ochilmagan (NEW) topshiriq — "yangi kelgani": brigadir avval shularni ko'rsin
      const fresh = openTasks.filter((t) => t.status === "NEW").length;
      cards.push(
        { key: "tasks", label: "Ochiq topshiriq", value: String(openTasks.length), hint: fresh ? `${fresh} tasi yangi` : mine.map((b) => b.name).join(", "), icon: "list", tone: openTasks.length ? "brand" : "success" },
        { key: "left", label: "Qolgan hajm", value: totalsText(leftRows), icon: "cube", tone: "info" },
        { key: "overdue", label: "Kechikkan", value: String(overdue), hint: overdue ? "muddati o'tgan" : undefined, icon: "alarm", tone: overdue ? "danger" : "success" },
        { key: "today", label: "Bugun bajardim", value: totalsText(todayProgress.map((p) => ({ unit: p.task.orderItem.product.unit, qty: p.qty }))), hint: `${todayProgress.length} qayd`, icon: "checkmark-done", tone: "success" },
      );
      sections.push(
        { title: "Topshiriqlarim", empty: "Ochiq topshiriq yo'q — brigadangizga tayinlansa shu yerda chiqadi", target: "tasks", rows: openTasks.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.orderItem.product.name}`, subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}${mine.length > 1 ? ` · ${t.brigade.name}` : ""}`, right: inUnit(sum(t.qty) - sum(t.doneQty), t.orderItem.product.unit), status: t.status, tone: t.dueDate < today ? "danger" as Tone : t.status === "NEW" ? "info" as Tone : "warning" as Tone })) },
        { title: "Yaqinda bajarilganlar", empty: "Hali bajarilgan topshiriq yo'q", target: "tasks", rows: recent.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.orderItem.product.name}`, subtitle: `${t.order.customer.name} · ${day(t.updatedAt)}`, right: inUnit(sum(t.qty), t.orderItem.product.unit), status: t.status, tone: "success" as Tone })) },
      );
      break;
    }
  }

  return { ...base, cards, sections, live: await liveTrucks(user) };
}

/**
 * Yo'ldagi mashinalar. Manba ikkita — ECO (pudratchi haydovchilar) va ERP'ning o'z izi
 * (zavod haydovchilari); `lib/live.ts` ularni qo'shadi. Xato bo'lsa bo'sh ro'yxat qaytadi,
 * bosh ekran buzilmaydi.
 */
async function liveTrucks(user: MobileUser): Promise<LiveTruck[]> {
  try {
    const trips = (await liveTrips({ userId: user.id, role: user.role })).trips.filter((t) => t.position);
    // ECO `ref` = ERP nakladnoy raqami; kartochka esa Trip.id bo'yicha ochiladi
    const ids = new Map(
      (await db.trip.findMany({ where: { deliveryNoteNo: { in: trips.map((t) => t.ref) } }, select: { id: true, deliveryNoteNo: true } }))
        .map((t) => [t.deliveryNoteNo, t.id]),
    );
    return trips
      .map((t) => ({
        ref: t.ref,
        tripId: ids.get(t.ref) ?? null,
        lat: t.position!.lat,
        lng: t.position!.lng,
        plate: t.plate ?? "—",
        driver: t.driver ?? "haydovchi yo'q",
        customer: t.customer,
        status: ecoLabel(t.status)?.label ?? t.status,
        km: Math.round(t.odometer.meters / 100) / 10,
        etaMin: t.position!.etaMin,
      }));
  } catch {
    return [];
  }
}
