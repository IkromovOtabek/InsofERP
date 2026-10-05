import { db } from "@/lib/db";
import { txSign } from "@/lib/cash-tx";
import { receivablesReport } from "@/lib/receivables";
import { loadSales } from "@/lib/bi/core";
import { customersCredit } from "@/lib/finance";
import { reportHistory } from "@/lib/production-report";
import { driverPositionNames } from "@/lib/positions";
import { ROLE_LABELS } from "@/lib/nav";
import { ecoLabel } from "@/lib/eco/labels";
import { liveTrips } from "@/lib/live";
import { CREATE_ROLES, canCreate } from "./create";
import { listsFor } from "./list";
import { prodFilter } from "@/lib/production";
import { SUPPLY_LABEL, totalPlanned } from "@/lib/supply";
import { soleUnit } from "@/lib/unit";
import { day, inUnit, money, num, short, shortSigned, sum, time, totalsText, tripQty } from "./fmt";
import { dashRange, roleDashboard } from "./dashboard";
import { ownerPeriod } from "./owner-period";
import { ownerCached } from "./owner-cache";
import { periodId } from "./sex";
import { hasDashDetail } from "./dash-detail";
import { brigadierHome } from "./brigadier";
import { toFleet } from "./fleet";
import { webList } from "./problems";
import { lineTotal } from "@/lib/receipt-vat";
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
  /**
   * Karta bosilganda ochiladigan joy: `id` bilan — batafsil kartochka (`/erp/<key>/<id>`),
   * `id` siz — ro'yxat (`/erp/list/<key>`). Eski ilova bilmaydi — karta oddiy turaveradi.
   */
  open?: { key: string; id?: string };
  /** Kalendardan tanlangan oraliq ("custom" filtr) — ilova kalendarini shu kunlar bilan ochadi. `YYYY-MM-DD`. */
  range?: { from: string; to: string } | null };
/** Bosh sahifa so'rovidagi ixtiyoriy parametrlar (karta filtrlari). */
export type HomeOpts = { revenue?: string; from?: string; to?: string;
  /** Rol dashboardi davri (`lib/mobile/dashboard.ts`): day | week | month | year | custom. */
  period?: string };

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
 *   · `columns` — oylar bo'yicha guruhli ustunlar (tushum / foyda / xarajat);
 *   · `bars` — tanlangan davr savatlari (soat / kun / hafta / oy) bo'yicha ustunlar, bosilsa raqami chiqadi;
 *   · `donut` — ulushlar halqasi (mahsulot, mijoz, kategoriya…), markazda jami.
 * Eski ilova `chart` ni bilmaydi va oddiy `rows` ni chizaveradi — shuning uchun rows ham to'ldiriladi.
 */
export type SectionChart =
  | { kind: "progress"; items: { label: string; pct: number | null; fact: string; plan: string | null; tone: Tone; invert?: boolean; open?: string }[] }
  | { kind: "columns"; series: { key: string; label: string; tone: Tone }[]; groups: { label: string; values: number[]; texts: string[] }[] }
  | { kind: "bars"; series: { key: string; label: string }[]; points: { label: string; values: number[]; texts: string[] }[]; total?: string }
  | { kind: "donut"; items: { label: string; value: number; text: string }[]; total: string; totalLabel?: string };
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
  /**
   * Logistika: BARCHA faol reyslar — GPS'i yo'qlari ham. Ilova xarita + ro'yxat qilib chizadi,
   * qator bosilganda xarita shu mashinaga yaqinlashadi. Bo'lsa ilova `live` o'rniga shuni ko'rsatadi.
   */
  fleet?: FleetTruck[];
};

/** Logistika xaritasidagi bitta reys — GPS bo'lmasa `gps` null, lekin qator ro'yxatda turadi. */
export type FleetTruck = {
  tripId: string;
  /** Nakladnoy raqami (ECO `ref` ham shu) */
  ref: string;
  plate: string;
  driver: string;
  driverPhone: string | null;
  customer: string;
  address: string;
  /** Bosqich nomi va rangi — TRIP_PHASE dan */
  phase: string;
  tone: Tone;
  /** Rejadagi soat "HH:MM" yoki null */
  plannedAt: string | null;
  /** "+25 daq" / "o'z vaqtida" / null */
  delay: string | null;
  delayTone: Tone | null;
  openIssues: number;
  gps: { lat: number; lng: number; at: string; etaMin: number | null; km: number | null } | null;
  /** Zayavka (kartochka uchun), reys holati, hajm va obyekt nuqtasi (navigator) — `./fleet.ts`. */
  orderId?: string;
  orderNo?: string;
  status?: string;
  qty?: string;
  dest?: { lat: number; lng: number } | null;
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
  AGENT: { key: "orders", title: "Zayavkalarim" },
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
  MECHANIC: { key: "trips", title: "Reyslar" },
  DRIVER: { key: "trips", title: "Mening reyslarim" },
  BRIGADIER: { key: "tasks", title: "Topshiriqlarim" },
  SUPERADMIN: { key: "approvals", title: "Tasdiqlar" }, // mobilga kirmaydi (faqat veb SSO) — jadval to'liq bo'lishi uchun
};

/** Tezkor amal katakchasi ikonlari (ilovadagi `design/icons.tsx` nomlari). */
const LIST_ICON: Record<string, string> = {
  orders: "document-text", sales: "trending-up", customers: "users", leads: "inbox", invoices: "receipt",
  production: "cube", recipes: "droplets", tasks: "checkbox", brigades: "hard-hat", "brig-issues": "triangle-alert", "brig-shifts": "clipboard-check",
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

const ORDER_TONE: Record<string, Tone> = { DRAFT: "info", BLOCKED: "danger", CONFIRMED: "brand", IN_PRODUCTION: "warning", DELIVERED: "success", CLOSED: "success", CANCELLED: "danger" };
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };


/** Vebdagi vazifa havolasi → ilovadagi ro'yxat (`./problems.ts` `webList`). Mos ro'yxat bo'lmasa qator bosilmaydi. */
const taskList = (href: string): string | undefined => webList(href);

/** Kassa va bank hisoblarining hozirgi qoldig'i. */
async function cashBalance() {
  const [pay, tx] = await Promise.all([
    db.payment.aggregate({ _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["type"], _sum: { amount: true } }),
  ]);
  // Barcha turlar ishorasi bilan (txSign): kirim, boshlang'ich qoldiq + ; chiqim − ; o'tkazmalar jamida 0 ga chiqadi
  return sum(pay._sum.amount) + tx.reduce((s, t) => s + txSign(t.type) * sum(t._sum.amount), 0);
}

/** Dashboard qoplab olgan eski "hozirgi holat" kartalari — ikki marta chiqmasin (kalitlar shu fayldagi `cards.push` lardan). */
const DASH_COVERS: Partial<Record<Role, string[]>> = {
  SALES: ["m3", "sum"],
  SUPERVISOR: ["tasks", "left", "overdue", "today"],
  LOGISTICS: ["cost"],
  WAREHOUSE: ["low"],
  PROCUREMENT: ["month", "docs", "suppliers", "supply"],
  ACCOUNTING: ["debt", "open"],
  FINANCE: ["balance"],
  CASHIER: ["balance"],
  HR: ["active"],
};

export async function mobileHome(user: MobileUser, opts: HomeOpts = {}): Promise<MobileHome> {
  const list = ROLE_LIST[user.role];
  // "+" tugmasi — rolning asosiy hujjati; qolgan formalar va ro'yxatlar "Tezkor amallar" to'rida.
  // To'r cheklanmaydi: vebda ko'ringan har bir bo'lim ilovada ham turadi (`lib/mobile/list.ts` — `ACCESS`).
  const creatables = Object.keys(CREATE_ROLES).filter((k) => canCreate(user, k));
  const creatable = creatables.find((k) => k === list.key) ?? creatables[0];
  const quick: QuickAction[] = [
    ...creatables.map((k) => ({ key: k, label: CREATE_ROLES[k].label, icon: "add", kind: "new" as const })),
    ...listsFor(user.role, user.perms).filter((l) => l.key !== list.key).map((l) => ({ key: l.key, label: l.title, icon: LIST_ICON[l.key] ?? "folder", kind: "list" as const })),
  ];
  const base = {
    role: user.role, roleLabel: ROLE_LABELS[user.role], fullName: user.fullName, list,
    create: creatable ? { key: creatable, label: CREATE_ROLES[creatable].label } : null,
    quick,
  };
  let cards: HomeCard[] = [];
  const sections: HomeSection[] = [];
  const today = startOfToday();
  // Logistika xaritasi: `live` bir marta olinadi va fleet bilan bo'lishiladi
  let live: LiveTruck[] | null = null;
  let fleet: FleetTruck[] | undefined;

  switch (user.role) {
    case "DIRECTOR": {
      // Vebdagi direktor bosh sahifasi (Egasi dashbordi, TZ v2.0) bilan bitta manba — `ownerDashboard()`.
      // Ilova raqamni o'zi hisoblamaydi: vebda nima bo'lsa, telefonda ham shu.
      const [d, trips, prodReports] = await Promise.all([
        ownerCached(),
        db.trip.findMany({ where: { status: { in: ["LOADED", "ON_ROAD"] } }, orderBy: { createdAt: "desc" }, take: 8, include: { order: { include: { customer: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } }, driver: true, vehicle: true } }),
        reportHistory(5),
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
      // Karta bosilsa — shu davr bo'yicha batafsil (`lib/mobile/dash-detail.ts`). Tushumdagi davr filtri
      // hamma kartaga tegishli: "oy" — vebdagi Egasi dashbordi raqamlari, boshqa davr — `ownerPeriod()`.
      const pid = period === "custom" ? `custom~${fmtYmd(cFrom!)}~${fmtYmd(cToIn!)}` : period;
      revenueCard.open = { key: "dash", id: `revenue.${pid}` };
      const dOpen = (k: string) => ({ key: "dash", id: `${k}.${pid}` });
      if (period !== "month") {
        const pr = dashRange({ period, from: opts.from, to: opts.to });
        const P = await ownerPeriod(pr);
        const pl = `(${periodLabel})`;
        const endTag = P.until ? ` (${periodLabel} oxirida)` : "";
        cards.push(
          revenueCard,
          { key: "profit", label: `Sof foyda ${pl}`, value: shortSigned(P.profit.net), hint: `yalpi ${short(P.profit.gross)} · xarajat ${short(P.profit.opex)}`, tone: P.profit.net < 0 ? "danger" : "success", icon: "banknote", open: dOpen("profit") },
          { key: "expenses", label: `Xarajatlar ${pl}`, value: short(P.expenses.total), hint: P.expenses.plan ? `byudjet ${short(P.expenses.plan)}` : `tushumning ${pctTxt(P.expenses.ratio)}`, tone: P.expenses.plan && P.expenses.total > P.expenses.plan ? "danger" : "success", icon: "wallet", open: dOpen("expenses") },
          { key: "cash", label: `Pul${endTag}`, value: short(P.cash.total), hint: `kassa ${short(P.cash.cash)} · bank ${short(P.cash.bank)}`, tone: P.cash.total < 0 ? "danger" : "success", icon: "landmark", open: dOpen("cash") },
          { key: "receivable", label: `Debitorka${endTag}`, value: short(P.receivable.total), hint: `${P.receivable.debtors} ta qarzdor`, tone: P.receivable.total > 0 ? "warning" : "success", icon: "receipt", open: dOpen("receivable") },
          // Muammolar — qaror kutayotgan hozirgi holat (tarixi yo'q)
          { key: "problems", label: "Muammolar (hozir)", value: String(d.problems.length), hint: d.problems.length ? "qaror kerak" : "hammasi joyida", tone: d.problems.length ? (d.problems.some((p) => p.level === "crit") ? "danger" : "warning") : "success", icon: "triangle-alert", open: dOpen("problems") },
          { key: "production", label: `Ishlab chiqarish ${pl}`, value: `${num(P.production.concrete)} m³`, hint: P.production.plan ? `plan ${num(P.production.plan)} m³ · ${pctTxt((P.production.concrete / P.production.plan) * 100)}` : `plan bajarilishi ${pctTxt(P.production.planPct)}`, tone: P.production.plan && P.production.concrete < P.production.plan * 0.9 ? "warning" : "success", icon: "factory", open: { key: "sex", id: `produced.${pid}` } },
          { key: "shipment", label: `Otgruzka ${pl}`, value: `${num(P.shipment.m3)} m³`, hint: `${P.shipment.trips} reys`, tone: "info", icon: "truck", open: dOpen("shipment") },
        );
      } else cards.push(
        revenueCard,
        { key: "profit", label: "Sof foyda", value: short(S.profit.month), hint: `prognoz ${short(S.profit.forecast)}`, tone: tone(L.profit), icon: "banknote", open: dOpen("profit") },
        { key: "expenses", label: "Xarajatlar", value: short(S.expenses.month), hint: S.expenses.plan ? `byudjet ${short(S.expenses.plan)}` : `tushumning ${pctTxt(S.expenses.ratio)}`, tone: tone(L.expenses), icon: "wallet", open: dOpen("expenses") },
        { key: "cash", label: "Pul", value: short(S.cash.total), hint: `kassa ${short(S.cash.cash)} · bank ${short(S.cash.bank)}`, tone: tone(L.cash), icon: "landmark", open: dOpen("cash") },
        { key: "receivable", label: "Debitorka", value: short(S.receivable.total), hint: S.receivable.overdue ? `muddati o'tgan ${short(S.receivable.overdue)}` : `${S.receivable.debtors} ta qarzdor`, tone: tone(L.receivable), icon: "receipt", open: dOpen("receivable") },
        { key: "problems", label: "Muammolar", value: String(d.problems.length), hint: d.problems.length ? "qaror kerak" : "hammasi joyida", tone: d.problems.length ? (d.problems.some((p) => p.level === "crit") ? "danger" : "warning") : "success", icon: "triangle-alert", open: dOpen("problems") },
        { key: "production", label: "Ishlab chiqarish", value: `${num(S.production.concreteMonth)} m³`, hint: S.production.concretePlan ? `plan ${num(S.production.concretePlan)} m³ · bugun ${num(S.production.concreteToday)}` : `bugun ${num(S.production.concreteToday)} m³`, tone: tone(L.production), icon: "factory", open: dOpen("production") },
        { key: "shipment", label: "Otgruzka", value: `${num(S.shipment.month)} m³`, hint: `bugun ${num(S.shipment.today)} m³ · ${S.shipment.tripsToday} reys`, tone: tone(L.transport), icon: "truck", open: dOpen("shipment") },
      );
      const decisionsSection: HomeSection = {
        title: "Egasi qarori kerak", empty: "Qaror talab qiladigan masala yo'q", icon: "triangle-alert",
                // Har qator — masala kartochkasi (`problem`): tafsilot, tarix, mas'ulga topshirish (`./problems.ts`)
        target: "problem",
        rows: d.decisions.slice(0, 8).map((x) => ({ id: x.key, title: x.problem, subtitle: `${x.decision} · ${x.owner} · ${x.due}`, right: x.amount ? short(Math.abs(x.amount)) : undefined, tone: tone(x.level) })),
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
        // Ishlab chiqarish (sex) "Qayd etish" bosgan kunlik hisobotlar — ochilsa "ko'rildi" belgilanadi
        {
          title: `Ishlab chiqarish hisobotlari${prodReports.some((r) => !r.seenAt) ? ` · ${prodReports.filter((r) => !r.seenAt).length} yangi` : ""}`,
          empty: "Hali hisobot qayd etilmagan", target: "prod-report", icon: "file-text",
          // Birinchi qator — bugungi jonli hisobot (08:00 dan hozirgacha soatma-soat); direktor faqat ko'radi
          rows: [{ id: "sex:report", title: "Bugun — jonli ko'rinish", subtitle: "08:00 dan hozirgacha soatma-soat · har qator bosiladi", tone: "info" as Tone }, ...prodReports.map((r) => ({ id: r.id, title: `${r.iso.split("-").reverse().join(".")}${r.latest ? "" : " (avvalgi nusxa)"}`, subtitle: `${r.summary} · ${r.by}`, right: r.seenAt ? "ko'rildi" : "yangi", tone: (r.seenAt ? "success" : "warning") as Tone }))],
        },
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
        { key: "blocked", label: "Bloklangan", value: String(blocked), tone: blocked ? "danger" : "success", icon: "lock-closed", open: { key: "dash", id: "blocked.month" } },
      );
      // Vebdagi "Zayavkalar" sahifasi tepasidagi ikki karta: ta'minot tasdig'i va sayt arizalari
      const [supplyWait, newLeads, leadRows] = await Promise.all([
        db.supplyRequest.count({ where: { status: "PRICED" } }),
        db.lead.count({ where: { status: "NEW" } }),
        db.lead.findMany({ where: { status: "NEW" }, orderBy: { createdAt: "desc" }, take: 5, include: { product: { select: { name: true } } } }),
      ]);
      if (supplyWait) cards.push({ key: "supply", label: "Ta'minot tasdig'i", value: String(supplyWait), hint: "sizni kutmoqda", tone: "warning", icon: "clipboard-list", open: { key: "supply" } });
      if (newLeads) cards.push({ key: "leads", label: "Yangi ariza", value: String(newLeads), hint: "saytdan", tone: "brand", icon: "inbox" });
      if (supplyWait) sections.push(await supplySection("Ta'minot — tasdiqingizni kutmoqda", "", ["PRICED"]));
      if (newLeads) sections.push({ title: "Saytdan yangi arizalar", empty: "", target: "leads", rows: leadRows.map((l) => ({ id: l.id, title: `${l.name} · ${l.phone}`, subtitle: `${day(l.createdAt)}${l.product ? ` · ${l.product.name}` : ""}${l.address ? ` · ${l.address}` : ""}`, status: "Yangi", tone: "brand" as Tone })) });
      sections.push({ title: "Mening zayavkalarim", empty: "Hali zayavka kiritmagansiz", target: "orders", rows: recent.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer.name}`, subtitle: `${day(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""} · ${o.deliveryAddress}`, right: totalsText(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))), status: o.status, tone: ORDER_TONE[o.status] })) });
      break;
    }

    // Sotuv agenti — o'z mijozlari, ularning qarzi va o'z zayavkalari (vebdagi `/agent` bilan bir xil mantiq)
    case "AGENT": {
      const [customers, recent] = await Promise.all([
        db.customer.findMany({ where: { agentId: user.id }, orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { id: true, name: true, phone: true, isActive: true } }),
        db.order.findMany({ where: { createdById: user.id }, orderBy: { date: "desc" }, take: 10, include: { customer: true, items: { include: { product: true } } } }),
      ]);
      const credit = await customersCredit(customers.map((c) => c.id));
      const totalDebt = customers.reduce((s, c) => s + (credit.get(c.id)?.debt ?? 0), 0);
      const debtors = [...credit.values()].filter((c) => c.debt > 0).length;
      cards.push(
        { key: "customers", label: "Mijozlarim", value: String(customers.length), hint: `${customers.filter((c) => c.isActive).length} faol`, tone: "brand", icon: "people", open: { key: "customers" } },
        { key: "debt", label: "Umumiy qarz", value: short(totalDebt), hint: "so'm", tone: totalDebt > 0 ? "warning" : "success", icon: "cash" },
        { key: "debtors", label: "Qarzdor mijoz", value: String(debtors), tone: debtors ? "warning" : "success", icon: "warning" },
      );
      sections.push(
        { title: "Mijozlarim", empty: "Sizga hali mijoz biriktirilmagan", target: "customers", rows: customers.map((c) => { const cr = credit.get(c.id); return { id: c.id, title: c.name, subtitle: `${c.phone ?? "telefonsiz"}${cr?.debt ? ` · qarz ${money(cr.debt)}` : ""}`, right: cr ? money(Math.max(0, cr.limit - cr.used)) : undefined, status: !c.isActive ? "Nofaol" : cr?.blacklisted ? "Qora ro'yxat" : undefined, tone: !c.isActive ? "info" : cr?.blacklisted ? "danger" : cr && cr.debt > 0 ? "warning" : "success" }; }) },
        { title: "Mening zayavkalarim", empty: "Hali zayavka kiritmagansiz", target: "orders", rows: recent.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer.name}`, subtitle: `${day(o.deliveryDate)} · ${o.deliveryAddress}`, right: totalsText(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))), status: o.status, tone: ORDER_TONE[o.status] })) },
      );
      break;
    }

    case "PRODUCTION": {
      const [batches, tasks, openTasks, prodOrders] = await Promise.all([
        db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: today } }, orderBy: { date: "desc" }, take: 10, include: { product: true, order: { include: { customer: true } } } }),
        db.brigadeTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } }),
        db.brigadeTask.findMany({ where: { status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, take: 10, include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } } }),
        // "Zayavkalar" ro'yxatidagi filtrlar bilan bir xil sanoq — `lib/production.ts`
        db.order.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { deliveryDate: "asc" }, take: 400, select: { status: true, deliveryDate: true, isUrgent: true, items: { select: { task: { select: { status: true } } } } } }),
      ]);
      const count = (key: string) => prodOrders.filter(prodFilter(key).test).length;
      const waiting = count("unassigned");
      const soon = count("soon");
      cards.push(
        { key: "today", label: "Bugungi zames", value: totalsText(batches.map((b) => ({ unit: b.product.unit, qty: b.qtyM3 }))), hint: `${batches.length} partiya`, tone: "brand", icon: "today", open: { key: "sex", id: "produced.day" } },
        { key: "unassigned", label: "Brigada kutayotgan", value: String(waiting), hint: "zayavka", tone: waiting ? "warning" : "success", icon: "hammer", open: { key: "orders" } },
        { key: "soon", label: "Muddati yaqin", value: String(soon), hint: "≤ 2 kun", tone: soon ? "danger" : "success", icon: "alarm", open: { key: "orders" } },
        { key: "tasks", label: "Ochiq topshiriq", value: String(tasks), tone: tasks ? "info" : "success", icon: "list", open: { key: "tasks" } },
      );
      sections.push(
        { title: "Ochiq topshiriqlar", empty: "Topshiriq yo'q", target: "tasks", rows: openTasks.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.brigade.name}`, subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`, right: inUnit(sum(t.qty) - sum(t.doneQty), t.orderItem.product.unit), status: t.status, tone: t.status === "NEW" ? "info" : "warning" })) },
        { title: "Bugungi zameslar", empty: "Bugun zames yo'q", target: "production", rows: batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: b.order ? b.order.customer.name : "Omborga", right: inUnit(sum(b.qtyM3), b.product.unit), status: `${b.shift}-smena` })) },
      );
      break;
    }

    case "SUPERVISOR": {
      const [openTasks, overdue, todayProgress, batches] = await Promise.all([
        db.brigadeTask.findMany({ where: { status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, take: 20, include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } } }),
        db.brigadeTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] }, dueDate: { lt: today } } }),
        db.taskProgress.findMany({ where: { date: { gte: today } }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
        db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: today } }, orderBy: { date: "desc" }, take: 10, include: { product: true, order: { include: { customer: true } } } }),
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
      const { minutesLabel } = await import("@/lib/logistics");
      const d = await logisticsDashboard();
      const k = d.kpi;
      cards.push(
        { key: "today", label: "Bugungi reyslar", value: String(k.trips), hint: `${k.done} yakunlandi`, tone: "brand", icon: "today", open: { key: "dash", id: "today.day" } },
        { key: "onroad", label: "Yo'ldagi transport", value: String(k.onRoad), hint: `${k.freeVehicles} bo'sh / ${k.totalVehicles}`, tone: "info", icon: "navigate", open: { key: "dash", id: "onroad.day" } },
        { key: "waiting", label: "Kutayotgan buyurtma", value: String(k.waitingOrders), hint: k.waitingQty ? `${k.waitingQty} biriktirilmagan` : undefined, tone: k.waitingOrders ? "warning" : "success", icon: "calendar", open: { key: "dash", id: "waiting.day" } },
        { key: "late", label: "Kechikmoqda", value: String(k.late), tone: k.late ? "danger" : "success", icon: "alarm" },
        { key: "m3", label: "Bugungi beton", value: `${k.concreteM3} m³`, hint: `o'rt. ${minutesLabel(k.avgDeliveryMin)}`, tone: "success", icon: "cube", open: { key: "dash", id: "delivered.day" } },
        { key: "cost", label: "Transport xarajati", value: money(k.cost), tone: "info", icon: "wallet" },
      );
      if (d.alerts.length) {
        // Bir reysga bir nechta ogohlantirish bo'lishi mumkin (kechikish + muammo) — qator id reys id'si,
        // ilovada React kaliti bo'lgani uchun har reysdan birinchisi (eng og'iri) qoladi.
        const seen = new Set<string>();
        // Qator bosilsa: reys ogohlantirishi — reys kartochkasi, zayavkaniki — zayavka (`orders:<id>`, `splitRef`).
        // Ilgari bo'limda `target` yo'q edi va reys qatorlari (eng ko'p uchraydigani) bosilmasdi.
        sections.push({ title: "Ogohlantirishlar", empty: "", icon: "alert-circle", target: "trips", rows: d.alerts.map((a, i) => {
          const path = a.href.split("?")[0];
          const tripId = path.startsWith("/trips/") && !path.includes("new") ? path.slice(7) : null;
          const orderId = /[?&]orderId=([^&]+)/.exec(a.href)?.[1] ?? (path.startsWith("/orders/") ? path.slice(8) : null);
          const id = tripId ?? (orderId ? `orders:${orderId}` : `a${i}`);
          return { id, title: a.title, subtitle: a.text, tone: a.level === "crit" ? "danger" as Tone : "warning" as Tone, ...(tripId || orderId ? {} : { open: "trips" }) };
        }).filter((row) => !seen.has(row.id) && !!seen.add(row.id)).slice(0, 8) });
      }
      // Faol reyslar — ro'yxat emas, xarita: ilova `fleet` ni xarita + mashinalar ro'yxati qilib chizadi
      // (vebdagi logistika paneli bilan bir xil). GPS'siz reys ham ro'yxatda turadi — "GPS yo'q" belgisi bilan.
      live = await liveTrucks(user);
      fleet = await toFleet(d, live);
      const waiting = d.orders.filter((o) => o.remaining > 0.001 && ["CONFIRMED", "PLANNED", "ASSIGNED", "LOADING", "ON_ROAD"].includes(o.status));
      if (waiting.length) sections.push({ title: "Transport kutayotgan buyurtmalar", empty: "", target: "orders", rows: waiting.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer}`, subtitle: `${o.deliveryTime ?? "soatsiz"} · ${o.address}`, right: `${o.remaining} ${o.unit === "m3" ? "m³" : o.unit}`, tone: o.late ? "danger" as Tone : "warning" as Tone })) });
      break;
    }

    case "WAREHOUSE": {
      const [materials, balances, receipts] = await Promise.all([
        db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
        db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
        db.goodsReceipt.findMany({ where: { cancelledAt: null, date: { gte: today } }, include: { supplier: true, items: true } }),
      ]);
      const bal = new Map(balances.map((b) => [b.materialId, sum(b._sum.qty)]));
      const low = materials.filter((m) => (bal.get(m.id) ?? 0) < sum(m.minStock));
      cards.push(
        { key: "low", label: "Kam qolgan", value: String(low.length), hint: low.length ? "buyurtma bering" : "hammasi yetarli", tone: low.length ? "danger" : "success", icon: "alert-circle" },
        { key: "kinds", label: "Xomashyo turi", value: String(materials.length), tone: "info", icon: "layers", open: { key: "stock" } },
        { key: "receipts", label: "Bugungi kirim", value: String(receipts.length), hint: "hujjat", tone: "brand", icon: "download" },
      );
      // Sklad ham snabjeniye amallarini bajaradi (`lib/supply-actions.ts` izohi): narx va qabul kutayotganlar shu yerda
      const [needPrice, needReceive] = await Promise.all([db.supplyRequest.count({ where: { status: "NEW" } }), db.supplyRequest.count({ where: { status: "FUNDED" } })]);
      cards.push({ key: "supply", label: "Ta'minot navbati", value: String(needPrice + needReceive), hint: needPrice || needReceive ? `${needPrice} narx · ${needReceive} qabul` : "navbat bo'sh", tone: needPrice + needReceive ? "warning" : "success", icon: "clipboard-list", open: { key: "supply" } });
      sections.push(
        { title: "Kam qolgan xomashyo", empty: "Hammasi minimumdan yuqori", target: "stock", rows: low.map((m) => ({ id: m.id, title: m.name, subtitle: `Minimum ${sum(m.minStock)} ${m.unit}`, right: `${(bal.get(m.id) ?? 0).toFixed(1)} ${m.unit}`, tone: "danger" })) },
        ...(needReceive ? [await supplySection("Qabul kutilmoqda — pul ajratilgan", "", ["FUNDED"])] : []),
        ...(needPrice ? [await supplySection("Narx kutayotgan so'rovlar", "", ["NEW"])] : []),
        { title: "Bugungi kirimlar", empty: "Bugun kirim yo'q", target: "receipts", rows: receipts.map((r) => ({ id: r.id, title: `${r.docNo} · ${r.supplier.name}`, subtitle: `${r.items.length} qator · ${time(r.date)}`, right: money(r.items.reduce((s, i) => s + lineTotal(i), 0)) })) },
      );
      break;
    }

    case "PROCUREMENT": {
      const [monthReceipts, suppliers, recent] = await Promise.all([
        db.goodsReceipt.findMany({ where: { cancelledAt: null, date: { gte: startOfMonth() } }, include: { items: true } }),
        db.supplier.count({ where: { isActive: true } }),
        db.goodsReceipt.findMany({ orderBy: { date: "desc" }, take: 12, include: { supplier: true, items: true } }),
      ]);
      const monthSum = monthReceipts.reduce((s, r) => s + r.items.reduce((x, i) => x + lineTotal(i), 0), 0);
      cards.push(
        { key: "month", label: "Oylik xarid", value: short(monthSum), hint: "so'm", tone: "brand", icon: "cart" },
        { key: "docs", label: "Oylik hujjat", value: String(monthReceipts.length), tone: "info", icon: "documents" },
        { key: "suppliers", label: "Yetkazuvchi", value: String(suppliers), tone: "success", icon: "people" },
      );
      const [needPrice, needReceive] = await Promise.all([db.supplyRequest.count({ where: { status: "NEW" } }), db.supplyRequest.count({ where: { status: "FUNDED" } })]);
      cards.push({ key: "supply", label: "Narx kutmoqda", value: String(needPrice), hint: needReceive ? `${needReceive} ta qabul kutmoqda` : undefined, tone: needPrice ? "warning" : "success", icon: "clipboard-list", open: { key: "supply" } });
      sections.push(
        await supplySection("Narx qo'yish kerak", "Narx kutayotgan so'rov yo'q", ["NEW"]),
        ...(needReceive ? [await supplySection("Qabul kutilmoqda — pul ajratilgan", "", ["FUNDED"])] : []),
        { title: "So'nggi kirimlar", empty: "Kirim yo'q", target: "receipts", rows: recent.map((r) => ({ id: r.id, title: `${r.docNo} · ${r.supplier.name}`, subtitle: `${day(r.date)} · ${r.items.length} qator${r.cancelledAt ? " · storno" : ""}`, right: r.cancelledAt ? "storno" : money(r.items.reduce((s, i) => s + lineTotal(i), 0)) })) },
      );
      break;
    }

    case "ACCOUNTING": {
      const [open, todayPay, invoices, recv] = await Promise.all([
        db.invoice.count({ where: { status: { in: ["OPEN", "PARTIAL"] } } }),
        db.payment.aggregate({ where: { date: { gte: today } }, _sum: { amount: true }, _count: true }),
        db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: { date: "asc" }, take: 12, include: { customer: true, payments: true } }),
        receivablesReport(), // yagona debitorka: schyotlar − barcha to'lovlar (schyotsiz avans ham)
      ]);
      const debt = recv.total;
      cards.push(
        { key: "debt", label: "Qarzdorlik", value: short(debt), hint: recv.advance > 0.005 ? `avans ${short(recv.advance)}` : `${recv.debtors} ta qarzdor`, tone: debt > 0 ? "danger" : "success", icon: "warning" },
        { key: "open", label: "Ochiq schyot", value: String(open), tone: "warning", icon: "receipt" },
        { key: "paid", label: "Bugungi to'lov", value: short(sum(todayPay._sum.amount)), hint: `${todayPay._count} ta`, tone: "success", icon: "checkmark-circle", open: { key: "dash", id: "payments.day" } },
      );
      const fundWait = await db.supplyRequest.count({ where: { status: "APPROVED" } });
      if (fundWait) {
        cards.push({ key: "supply", label: "Ta'minot to'lovi", value: String(fundWait), hint: "tasdiq kutmoqda", tone: "warning", icon: "clipboard-list", open: { key: "supply" } });
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
        db.cashTransaction.findMany({ where: { type: { not: "OPENING" } }, orderBy: { date: "desc" }, take: 12, include: { cashAccount: true } }),
      ]);
      cards.push(
        { key: "balance", label: "Kassa qoldig'i", value: short(balance), hint: "so'm", tone: balance >= 0 ? "success" : "danger", icon: "wallet" },
        { key: "in", label: "Bugungi kirim", value: short(sum(inToday._sum.amount)), tone: "brand", icon: "arrow-down-circle" },
        { key: "out", label: "Bugungi chiqim", value: short(sum(outToday._sum.amount)), tone: "warning", icon: "arrow-up-circle" },
      );
      // Vebdagi Kirim-Chiqim tepasidagi "Ta'minot to'lovlari" kartasi
      const fundWait = await db.supplyRequest.count({ where: { status: "APPROVED" } });
      cards.push({ key: "supply", label: "Ta'minot to'lovi", value: String(fundWait), hint: fundWait ? "tasdiq kutmoqda" : "navbat bo'sh", tone: fundWait ? "warning" : "success", icon: "clipboard-list", open: { key: "supply" } });
      if (fundWait) sections.push(await supplySection("Ta'minot to'lovlari — tasdiq kutilmoqda", "", ["APPROVED"]));
      sections.push({ title: "So'nggi harakatlar", empty: "Harakat yo'q", target: "cashflow", rows: recent.map((t) => ({ id: t.id, title: `${t.category}${t.counterparty ? ` · ${t.counterparty}` : ""}`, subtitle: `${day(t.date)} · ${t.cashAccount.name}`, right: `${txSign(t.type) < 0 ? "−" : "+"}${money(sum(t.amount))}`, tone: t.type === "TRANSFER_IN" || t.type === "TRANSFER_OUT" ? "info" : txSign(t.type) < 0 ? "danger" : "success" })) });
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
        { key: "drivers", label: "Haydovchi", value: String(drivers), tone: "brand", icon: "car", open: { key: "drivers" } },
        { key: "brigadiers", label: "Brigadir", value: String(brigades.length - headless), hint: headless ? `${headless} brigada brigadirsiz` : `${brigades.length} brigada`, tone: headless ? "warning" : "success", icon: "construct", open: { key: "brigades" } },
        { key: "inactive", label: "Nofaol", value: String(inactive), tone: inactive ? "warning" : "info", icon: "person-remove", open: { key: "dash", id: "inactive.month" } },
      );
      sections.push(
        // Qator — brigada kartochkasi (a'zolar, brigadir, topshiriqlar); ilgari `target` yo'q edi va bosilmasdi
        { title: "Brigadalar", empty: "Brigada yo'q", target: "brigades", rows: brigades.map((b) => ({ id: b.id, title: b.name, subtitle: b.leader ? `Brigadir: ${b.leader.fullName}${b.leader.phone ? ` · ${b.leader.phone}` : ""}` : "Brigadir biriktirilmagan — Xodimlar kartochkasidan tanlang", right: `${b.tasks.length} topshiriq`, tone: b.leader ? "success" : "warning" })) },
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
        { key: "today", label: "Bugungi tushum", value: short(sum(todayPay._sum.amount)), hint: "so'm", tone: "success", icon: "today", open: { key: "dash", id: "payments.day" } },
        { key: "count", label: "Bugungi to'lovlar", value: String(todayPay._count), tone: "brand", icon: "swap-horizontal", open: { key: "dash", id: "payments.day" } },
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
        { key: "active", label: "Ochiq reys", value: String(active.length), hint: me.vehicle?.plate ?? "mashina biriktirilmagan", tone: active.length ? "brand" : "success", icon: "bus", open: { key: "trips" } },
        { key: "todayM3", label: "Bugun yetkazdim", value: totalsText(doneToday.map((t) => ({ unit: soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? "m3", qty: t.qtyM3 }))), hint: `${doneToday.length} reys`, tone: "success", icon: "checkmark-done", open: { key: "dash", id: "delivered.day" } },
        { key: "todayAll", label: "Bugungi reyslar", value: String(todayTrips.length), tone: "info", icon: "today", open: { key: "dash", id: "trips.day" } },
      );
      sections.push(
        { title: "Ochiq reyslarim", empty: "Ochiq reys yo'q", target: "trips", rows: active.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.order.deliveryAddress} · ${t.vehicle.plate}`, right: tripQty(t), status: t.status, tone: TRIP_TONE[t.status] })) },
        { title: "Yaqinda yetkazganlarim", empty: "Hali yetkazilgan reys yo'q", target: "trips", rows: upcoming.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.deliveredAt ? day(t.deliveredAt) : ""} · ${t.vehicle.plate}`, right: tripQty(t), status: t.status, tone: "success" })) },
      );
      break;
    }

    // Brigadir: smena holati, ogohlantirishlar, brigada xodimlari, faol topshiriqlar, uskunalar,
    // smena hisobotlari — faqat O'Z brigadasi (`./brigadier.ts`). KPI va grafiklar — `dashboard.ts`.
    case "BRIGADIER": {
      const b = await brigadierHome(user);
      cards.push(...b.cards);
      sections.push(...b.sections);
      break;
    }
  }

  // Rol dashboardi (davr filtri, KPI, diagrammalar) — direktordan tashqari hammaga; bosh ko'rsatkich
  // dashboardniki, hozirgi holat kartalari va ro'yxatlar undan keyin turadi (`lib/mobile/dashboard.ts`).
  if (user.role !== "DIRECTOR") {
    const dash = await roleDashboard(user, dashRange(opts));
    if (dash) {
      // Dashboard kartasi bilan bir xil kalitli holat kartasi tushib qoladi — ilova `key` ni React kaliti qiladi
      // (logistika: ikkalasida ham "late" bor edi → "Encountered two children with the same key").
      const drop = new Set([...(DASH_COVERS[user.role] ?? []), dash.hero.key, ...dash.tiles.map((t) => t.key)]);
      // Har karta bosilganda batafsil kartochka (`lib/mobile/dash-detail.ts`): davr bosh ekrandagi filtr bilan bir xil.
      // Sex kartalari o'z kartochkasini (`sex`) ochadi; batafsili yozilmagan karta eski `open` bilan qoladi.
      const pid = periodId(dashRange(opts));
      const withOpen = (c: HomeCard): HomeCard => (c.open?.key === "sex" || !hasDashDetail(user.role, c.key) ? c : { ...c, open: { key: "dash", id: `${c.key}.${pid}` } });
      // Davr filtri hamma raqamga tegishli: kun/oyga qotib qolgan eski kartalar ("Bugungi kirim", "Oylik hajm")
      // hafta/oy/yil tanlanganda chiqmaydi — ularning davrli nusxasi dashboard kartalarida bor. Qolgan holat
      // kartalari (bloklangan, navbat, yo'ldagi transport) — ish navbati, davrga bog'lanmaydi: "(hozir)" belgisi bilan.
      const r = dashRange(opts);
      const rest = cards.filter((c) => !drop.has(c.key))
        .filter((c) => r.key === "day" || !/^(Bugun|Bugungi|Oylik)\b/.test(c.label))
        .map((c) => (r.key === "day" || c.key === "nolink" ? c : { ...c, label: `${c.label} (hozir)` }));
      cards = [withOpen(dash.hero), ...dash.tiles.map(withOpen), ...rest];
      // Brigadir: hujjatdagi tartib — ogohlantirishlar va brigada tarkibi grafiklardan oldin
      if (user.role === "BRIGADIER") sections.splice(2, 0, ...dash.charts);
      else sections.unshift(...dash.charts);
    }
  }
  return { ...base, cards, sections, live: live ?? await liveTrucks(user), ...(fleet ? { fleet } : {}) };
}

/**
 * Yo'ldagi mashinalar. Manba ikkita — ECO (pudratchi haydovchilar) va ERP'ning o'z izi
 * (zavod haydovchilari); `lib/live.ts` ularni qo'shadi. Xato bo'lsa bo'sh ro'yxat qaytadi,
 * bosh ekran buzilmaydi.
 */
export async function liveTrucks(user: MobileUser): Promise<LiveTruck[]> {
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
