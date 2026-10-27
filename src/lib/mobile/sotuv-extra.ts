import { db } from "@/lib/db";
import type { OrderStatus, Prisma, Role, SmmApproval, SmmBoostObjective, SmmBoostStatus } from "@/generated/prisma";
import { dateRu, fmtNum, isoDate, money } from "@/lib/format";
import { fmtUnitTotals, unitLabel } from "@/lib/unit";
import { contractedIds, customersCredit, customersHistory, STAR_LABELS } from "@/lib/finance";
import { customerStatement } from "@/lib/invoices";
import { deleteCustomerSite, saveCustomerSite, siteDebts } from "@/lib/customer-sites";
import { assignCustomerAgentLib, canSetCreditLimit, saveCustomerLib } from "@/lib/customer-admin";
import { cancelOrderWithReason, closeStockOrderLib, setGuarantee, setOrderContract } from "@/lib/order-docs";
import { orderConfirm } from "@/lib/orders";
import { createStockOrder } from "@/lib/stock-orders";
import {
  OFFER_STATE, OFFER_UNITS, acceptOfferByManager, cancelOffer, createOffer, offerDefaults, offerPublicPath, offerState, offerStateWhere,
  offerToday, offerTotals, offerUnitLabel, type OfferState,
} from "@/lib/offers";
import { publicOrigin } from "@/lib/public-url";
import { groupPath, productCatalog } from "@/lib/product-catalog";
import { setShopItemPrice, setShopItemPublished } from "@/lib/shop-admin";
import { submitContent } from "@/lib/smm/approval";
import { publishContent } from "@/lib/smm/publish";
import { marketingSettings, requestBoost, toggleBoost } from "@/lib/smm/boosts";
import { AUDIENCES } from "@/lib/smm/audiences";
import { APPROVAL, BOOST_OBJECTIVE, BOOST_STATUS, CHANNEL_LABEL, MEDIA_TYPE_LABEL, PUB_STATUS } from "@/lib/smm/labels";
import { analytics, syncMarketingNow } from "@/lib/smm/insights";
import { customerAppStatus, findAppCandidates, linkCustomerApp, syncCustomerLater } from "@/lib/eco/customers";
import { dataUrlFile } from "@/lib/procurement";
import type { MobileUser } from "./auth";
import { can, type DetailAction, type DetailField, type FormField, type FormOption, type MobileDetail } from "./detail";
import type { HomeRow, HomeSection, Tone } from "./home";
import { ListError, skladPeriod, type ListFilter, type MobileList } from "./list";
import type { ActionResult } from "./actions";
import { canCreate, type CreateForm, type CreateResult } from "./create";
import { SOTUV_ACTION_ROLES } from "./sotuv-access";

/**
 * Sotuv va agent kabineti — veb ERP'dagi funksiyalarning mobil ilovadagi ko'rinishi (ERP → mobil paritet).
 * Ro'yxat filtrlari, kartochka bo'limlari, amallar va formalar. Qoidalar `lib/*` da (veb bilan bitta joyda):
 * `lib/order-docs.ts`, `lib/customer-admin.ts`, `lib/customer-sites.ts`, `lib/offers.ts`, `lib/shop-admin.ts`, `lib/smm/*`.
 * Ruxsat jadvallari — `./sotuv-access.ts`.
 */

const TAKE = 60;
const sum = (n: unknown) => Number(n ?? 0);
const dm = (d: Date) => dateRu(d).slice(0, 5);
const hm = (d: Date) => `${dm(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const clip = (t: string | null | undefined, n: number) => (t && t.length > n ? `${t.slice(0, n)}…` : t ?? "");
function fail(m: string, status = 400): never { throw new ListError("ACTION_FAILED", m, status); }
const textOf = (p: Record<string, unknown>, key: string) => String(p[key] ?? "").trim();
const numOf = (p: Record<string, unknown>, key: string) => {
  const n = Number(textOf(p, key).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const boolOf = (p: Record<string, unknown>, key: string, dflt: boolean) => (p[key] === undefined ? dflt : p[key] === true || p[key] === "true");
const isDirectorOr = (user: MobileUser, roles: Role[]) => user.role === "DIRECTOR" || roles.includes(user.role);

const ORDER_LABEL: Record<string, string> = { DRAFT: "Qoralama", BLOCKED: "Bloklangan", CONFIRMED: "Tasdiqlangan", IN_PRODUCTION: "Ishlab chiqarilmoqda", DELIVERED: "Yetkazildi", CLOSED: "Yopilgan", CANCELLED: "Bekor" };
const ORDER_TONE: Record<string, Tone> = { DRAFT: "info", BLOCKED: "danger", CONFIRMED: "brand", IN_PRODUCTION: "warning", DELIVERED: "success", CLOSED: "success", CANCELLED: "danger" };

/** Bekor qilish sababi — veb `ConfirmButton reason="required"` bilan bir xil (kamida 3 belgi, auditga yoziladi). */
export const REASON_FORM: FormField[] = [
  { name: "reason", label: "Bekor qilish sababi", type: "text", required: true, placeholder: "Mijoz voz kechdi / xato kiritilgan…" },
];

// ═════════════════════════ Ro'yxatlar ═════════════════════════

/** Sotuv ro'yxatlari — `list.ts` `mobileList` shu yerga yo'naltiradi. Boshqa kalit — null. */
export async function sotuvList(user: MobileUser, key: string, title: string, q?: string, filter?: string): Promise<MobileList | null> {
  switch (key) {
    case "orders": return ordersList(user, title, q, filter);
    case "sales": return salesList(title, q, filter);
    case "customers": return customersList(user, title, q, filter);
    case "invoices": return invoicesList(title, q, filter);
    case "offers": return offersList(title, q, filter);
    case "shop": return shopList(title, q, filter);
    case "smm": return smmList(title, q, filter);
    case "target": return boostsList(title, q, filter);
    case "marketing": return marketingList(title, filter);
    default: return null;
  }
}

/** Zayavkalar — vebdagi `/orders` holat tablari va «Mijoz uchun / Sklad uchun» turi. Agent — faqat o'zi kiritganlari. */
async function ordersList(user: MobileUser, title: string, q?: string, filter?: string): Promise<MobileList> {
  const isAgent = user.role === "AGENT";
  const chips: { key: string; label: string; where: Prisma.OrderWhereInput }[] = [
    { key: "all", label: "Hammasi", where: {} },
    { key: "DRAFT", label: "Qoralama", where: { status: "DRAFT" } },
    { key: "BLOCKED", label: "Bloklangan", where: { status: "BLOCKED" } },
    { key: "CANCELLED", label: "Bekor", where: { status: "CANCELLED" } },
    // Agent faqat mijoz zayavkasini ochadi — tur chiplari unga kerak emas
    ...(isAgent ? [] : [
      { key: "SALE", label: "Mijoz uchun", where: { kind: "SALE" as const } },
      { key: "STOCK", label: "Sklad uchun (zaxira)", where: { kind: "STOCK" as const } },
    ]),
  ];
  const chip = chips.find((c) => c.key === filter) ?? chips[0];
  const own: Prisma.OrderWhereInput = isAgent ? { createdById: user.id } : {};
  const search: Prisma.OrderWhereInput = q ? { OR: [{ orderNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { deliveryAddress: { contains: q, mode: "insensitive" } }] } : {};
  const [list, counts] = await Promise.all([
    db.order.findMany({ where: { AND: [own, chip.where, search] }, orderBy: { date: "desc" }, take: TAKE, include: { customer: true, items: { include: { product: { select: { unit: true } } } } } }),
    Promise.all(chips.map((c) => db.order.count({ where: { AND: [own, c.where] } }))),
  ]);
  return {
    key: "orders", title: isAgent ? "Zayavkalarim" : title,
    rows: list.map((o) => ({
      id: o.id,
      title: o.kind === "STOCK" ? "Sklad zaxirasi" : o.customer.name,
      subtitle: `${o.dateUnknown ? "Sana aniq emas" : `${dm(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""}`} · ${o.deliveryAddress}`,
      right: fmtUnitTotals(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))),
      status: o.status, tone: ORDER_TONE[o.status],
    })),
    filters: chips.map((c, i) => ({ key: c.key, label: c.label, count: counts[i], active: c.key === chip.key })),
  };
}

const SALES_STATUSES: OrderStatus[] = ["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"];
const PERIODS = [
  { key: "today", label: "Bugun" }, { key: "week", label: "Hafta" }, { key: "month", label: "Oy" },
  { key: "prev", label: "O'tgan oy" }, { key: "year", label: "Yil" },
] as const;

/** Davr (sukut — joriy oy, vebdagi `/sales` kabi). `to` eksklyuziv. */
function salesPeriod(key?: string) {
  if (key === "year") {
    const now = new Date(); const from = new Date(now.getFullYear(), 0, 1);
    const to = new Date(now); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
    return { key: "year", label: "Yil", from, to, range: `${dateRu(from)} — ${dateRu(now)}` };
  }
  return skladPeriod(key);
}

/**
 * Sotuv — vebdagi `/sales`: holat tablari + davr (sukut — joriy oy). Filtr kaliti `<holat>~<davr>`:
 * davr chipi davrni tanlab, hamma holatni ko'rsatadi; holat chipi joriy davr ichida saralaydi (davr sarlavhada).
 */
async function salesList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const [a, b] = (filter ?? "").split("~");
  const st = SALES_STATUSES.find((s) => s === a);
  const pk = PERIODS.find((p) => p.key === b)?.key ?? PERIODS.find((p) => p.key === a)?.key ?? "month";
  const p = salesPeriod(pk);
  const base: Prisma.OrderWhereInput = { kind: "SALE", date: { gte: p.from, lt: p.to } };
  const search: Prisma.OrderWhereInput = q ? { OR: [{ orderNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {};
  const [rows, counts] = await Promise.all([
    db.order.findMany({
      where: { AND: [base, { status: st ?? { in: SALES_STATUSES } }, search] },
      orderBy: { updatedAt: "desc" }, take: TAKE,
      include: { customer: true, items: { include: { product: true } }, invoices: { where: { status: { not: "CANCELLED" } }, include: { payments: true } } },
    }),
    db.order.groupBy({ by: ["status"], where: { ...base, status: { in: SALES_STATUSES } }, _count: { _all: true } }),
  ]);
  const by = (s: OrderStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  return {
    key: "sales", title: `${title} · ${p.label}${st ? ` · ${ORDER_LABEL[st]}` : ""}`,
    rows: rows.map((o) => {
      const total = o.items.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0);
      const paid = o.invoices.reduce((s, i) => s + i.payments.reduce((x, y) => x + sum(y.amount), 0), 0);
      return {
        id: o.id, title: o.customer.name,
        subtitle: `${dm(o.deliveryDate)} · ${o.items.map((i) => i.product.code).join(", ")}${o.invoices.length ? ` · to'langan ${money(paid)}` : " · schyot yo'q"}`,
        right: money(total), status: ORDER_LABEL[o.status] ?? o.status, tone: ORDER_TONE[o.status],
      };
    }),
    filters: [
      ...PERIODS.map((x) => ({ key: `all~${x.key}`, label: x.label, active: !st && x.key === p.key })),
      ...SALES_STATUSES.map((s) => ({ key: `${s}~${p.key}`, label: ORDER_LABEL[s], count: by(s), active: s === st })),
    ],
  };
}

/** Mijozlar — vebdagi `/customers` tablari + «Qarzdorlar» (qarzi kattasi tepada). Agent — faqat o'z mijozlari. */
async function customersList(user: MobileUser, title: string, q?: string, filter?: string): Promise<MobileList> {
  const isAgent = user.role === "AGENT";
  const all = await db.customer.findMany({
    where: { isInternal: false, ...(isAgent ? { agentId: user.id } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { inn: { contains: q } }] } : {}) },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  const ids = all.map((c) => c.id);
  const [credit, contracted] = await Promise.all([customersCredit(ids), contractedIds(ids)]);
  const cr = (id: string) => credit.get(id);
  const tabs: { key: string; label: string; test: (c: (typeof all)[number]) => boolean }[] = [
    { key: "all", label: "Hammasi", test: () => true },
    { key: "debt", label: "Qarzdorlar", test: (c) => (cr(c.id)?.debt ?? 0) > 0.005 },
    { key: "black", label: "Qora ro'yxat", test: (c) => c.isActive && !!cr(c.id)?.blacklisted },
    { key: "contract", label: "Shartnomali", test: (c) => contracted.has(c.id) },
    { key: "inactive", label: "Nofaol", test: (c) => !c.isActive },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  let shown = all.filter(tab.test);
  if (tab.key === "debt") shown = [...shown].sort((a, b) => (cr(b.id)?.debt ?? 0) - (cr(a.id)?.debt ?? 0));
  shown = shown.slice(0, TAKE);
  const history = await customersHistory(shown.map((c) => c.id), credit);
  return {
    key: "customers", title: isAgent ? "Mijozlarim" : title,
    rows: shown.map((c) => {
      const x = cr(c.id);
      const h = history.get(c.id);
      const black = !!x?.blacklisted;
      return {
        id: c.id, title: `${c.name}${contracted.has(c.id) ? " · shartnoma" : ""}`,
        subtitle: `${c.phone ?? "telefonsiz"}${h ? ` · ${STAR_LABELS[h.stars]}` : ""}${x?.debt ? ` · qarz ${money(x.debt)}` : ""}`,
        right: x ? (tab.key === "debt" ? money(x.debt) : money(Math.max(0, x.limit - x.used))) : undefined,
        status: !c.isActive ? "Nofaol" : black ? "Qora ro'yxat" : undefined,
        tone: (!c.isActive ? "info" : black ? "danger" : x && x.debt > 0 ? "warning" : "success") as Tone,
      };
    }),
    filters: tabs.map((t) => ({ key: t.key, label: t.label, count: all.filter(t.test).length, active: t.key === tab.key })),
  };
}

const INVOICE_TABS = [
  { key: "all", label: "Hammasi" }, { key: "OPEN", label: "Ochiq" }, { key: "PARTIAL", label: "Qisman to'langan" },
  { key: "PAID", label: "To'langan" }, { key: "CANCELLED", label: "Bekor" },
] as const;

/** Schyotlar — vebdagi `/invoices` holat tablari. */
async function invoicesList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tab = INVOICE_TABS.find((t) => t.key === filter) ?? INVOICE_TABS[0];
  const status = tab.key === "all" ? undefined : tab.key;
  const [list, counts] = await Promise.all([
    db.invoice.findMany({
      where: { ...(status ? { status } : {}), ...(q ? { OR: [{ invoiceNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
      orderBy: { date: "desc" }, take: TAKE, include: { customer: true, payments: true },
    }),
    db.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const by = (k: string) => (k === "all" ? counts.reduce((n, c) => n + c._count._all, 0) : counts.find((c) => c.status === k)?._count._all ?? 0);
  return {
    key: "invoices", title,
    rows: list.map((i) => {
      const left = sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0);
      return { id: i.id, title: `${i.invoiceNo} · ${i.customer.name}`, subtitle: `${dm(i.date)} · jami ${money(sum(i.amount))}`, right: money(left), status: i.status, tone: (i.status === "PAID" ? "success" : i.status === "PARTIAL" ? "warning" : i.status === "CANCELLED" ? "info" : "danger") as Tone };
    }),
    filters: INVOICE_TABS.map((t) => ({ key: t.key, label: t.label, count: by(t.key), active: t.key === tab.key })),
  };
}

const OFFER_TONE: Record<OfferState, Tone> = { ACTIVE: "brand", ACCEPTED: "success", EXPIRED: "warning", CANCELLED: "danger" };
const offerGross = (o: { withVat: boolean; items: { name: string; unit: string; qty: unknown; price: unknown }[] }) =>
  offerTotals(o.items.map((i) => ({ name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })), o.withVat).gross;

/** Tijorat takliflari — vebdagi `/takliflar` holat tablari. */
async function offersList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tabs: { key: string; label: string; state?: OfferState }[] = [
    { key: "all", label: "Hammasi" }, { key: "ACTIVE", label: "Amal qiladi", state: "ACTIVE" }, { key: "ACCEPTED", label: "Qabul qilingan", state: "ACCEPTED" },
    { key: "EXPIRED", label: "Muddati o'tgan", state: "EXPIRED" }, { key: "CANCELLED", label: "Bekor qilingan", state: "CANCELLED" },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const s = q?.trim();
  const search: Prisma.CommercialOfferWhereInput = s ? { OR: [{ offerNo: { contains: s, mode: "insensitive" } }, { clientName: { contains: s, mode: "insensitive" } }, { objectName: { contains: s, mode: "insensitive" } }] } : {};
  const [rows, counts] = await Promise.all([
    db.commercialOffer.findMany({ where: { AND: [offerStateWhere(tab.state), search] }, orderBy: { createdAt: "desc" }, take: TAKE, include: { items: true, manager: { select: { fullName: true } } } }),
    Promise.all(tabs.map((t) => db.commercialOffer.count({ where: offerStateWhere(t.state) }))),
  ]);
  return {
    key: "offers", title,
    rows: rows.map((o) => {
      const st = offerState(o);
      return {
        id: o.id, title: `${o.offerNo} · ${o.clientName}`,
        subtitle: `${dm(o.date)} · ${dm(o.validUntil)} gacha · ${o.manager.fullName}${o.viewCount ? ` · ${o.viewCount} marta ochildi` : " · mijoz ochmagan"}`,
        right: money(offerGross(o)), status: OFFER_STATE[st].label, tone: OFFER_TONE[st],
      };
    }),
    filters: tabs.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], active: t.key === tab.key })),
  };
}

/** E-commerce vitrinasi — vebdagi `/e-commerce` «Vitrina» tabi: ilovada ko'rinadi / yashirin. */
async function shopList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tabs: { key: string; label: string; where: Prisma.ProductWhereInput }[] = [
    { key: "all", label: "Hammasi", where: {} },
    { key: "on", label: "Ilovada ko'rinadi", where: { shopItem: { is: { isPublished: true } } } },
    { key: "off", label: "Yashirin", where: { OR: [{ shopItem: { is: null } }, { shopItem: { is: { isPublished: false } } }] } },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const base: Prisma.ProductWhereInput = { isActive: true };
  const search: Prisma.ProductWhereInput = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {};
  const [list, counts] = await Promise.all([
    db.product.findMany({ where: { AND: [base, tab.where, search] }, orderBy: [{ shopItem: { sortOrder: "asc" } }, { code: "asc" }], take: TAKE, include: { shopItem: true } }),
    Promise.all(tabs.map((t) => db.product.count({ where: { AND: [base, t.where] } }))),
  ]);
  return {
    key: "shop", title,
    rows: list.map((p) => {
      const it = p.shopItem;
      const price = it?.price != null ? Number(it.price) : Number(p.price);
      return {
        id: p.id, title: it?.title?.trim() || p.name,
        subtitle: `${p.code} · ${unitLabel(p.unit)}${it?.price != null ? ` · do'kon narxi (bazaviy ${money(Number(p.price))})` : " · bazaviy narx"}${it?.photo ? "" : " · suratsiz"}`,
        right: money(price),
        status: it?.isPublished ? "Ko'rinadi" : "Yashirin", tone: (it?.isPublished ? "success" : "info") as Tone,
      };
    }),
    filters: tabs.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], active: t.key === tab.key })),
  };
}

const SMM_TYPE: Record<string, string> = { REELS: "Reels", POST: "Post", STORIES: "Stories", ARTICLE: "Maqola" };
const APPROVAL_TONE: Record<SmmApproval, Tone> = { DRAFT: "info", PENDING: "warning", APPROVED: "success", REJECTED: "danger" };

/** Kontent reja — vebdagi `/marketing/kontent`: tasdiq holati bo'yicha. Bekor qilinganlar ko'rinmaydi. */
async function smmList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const live: Prisma.MarketingContentWhereInput = { status: { notIn: ["CANCELLED", "PUBLISHED"] } };
  const tabs: { key: string; label: string; where: Prisma.MarketingContentWhereInput }[] = [
    { key: "all", label: "Ochiq", where: live },
    { key: "DRAFT", label: "Qoralama", where: { ...live, approval: "DRAFT" } },
    { key: "PENDING", label: "Tasdiq kutilmoqda", where: { ...live, approval: "PENDING" } },
    { key: "APPROVED", label: "Tasdiqlangan", where: { ...live, approval: "APPROVED" } },
    { key: "REJECTED", label: "Rad etilgan", where: { ...live, approval: "REJECTED" } },
    { key: "PUBLISHED", label: "Chiqqan", where: { status: "PUBLISHED" } },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const search: Prisma.MarketingContentWhereInput = q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { caption: { contains: q, mode: "insensitive" } }] } : {};
  const [list, counts] = await Promise.all([
    db.marketingContent.findMany({ where: { AND: [tab.where, search] }, orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }], take: TAKE }),
    Promise.all(tabs.map((t) => db.marketingContent.count({ where: t.where }))),
  ]);
  return {
    key: "smm", title,
    rows: list.map((c) => ({
      id: c.id, title: c.title,
      subtitle: `${SMM_TYPE[c.type] ?? c.type} · ${c.channels.map((x) => CHANNEL_LABEL[x]).join(", ") || "tarmoq tanlanmagan"} · ${c.scheduledAt ? hm(c.scheduledAt) : "vaqt belgilanmagan"}`,
      status: c.status === "PUBLISHED" ? "Chiqdi" : APPROVAL[c.approval].label,
      tone: c.status === "PUBLISHED" ? "success" : APPROVAL_TONE[c.approval],
    })),
    filters: tabs.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], active: t.key === tab.key })),
  };
}

const BOOST_TONE: Record<SmmBoostStatus, Tone> = { PENDING_APPROVAL: "warning", REJECTED: "danger", LAUNCHING: "brand", ACTIVE: "success", PAUSED: "info", COMPLETED: "info", FAILED: "danger", SIMULATED: "info" };

/** Target — vebdagi `/marketing/target`: so'rovlar va ishlayotgan reklamalar. Kartochka — `boost`. */
async function boostsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tabs: { key: string; label: string; status?: SmmBoostStatus[] }[] = [
    { key: "all", label: "Hammasi" },
    { key: "PENDING", label: "Tasdiq kutilmoqda", status: ["PENDING_APPROVAL"] },
    { key: "ACTIVE", label: "Faol", status: ["LAUNCHING", "ACTIVE"] },
    { key: "PAUSED", label: "To'xtatilgan", status: ["PAUSED"] },
    { key: "DONE", label: "Tugagan", status: ["COMPLETED", "REJECTED", "FAILED", "SIMULATED"] },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const where = (t: (typeof tabs)[number]): Prisma.SmmBoostWhereInput => (t.status ? { status: { in: t.status } } : {});
  const [list, counts, st] = await Promise.all([
    db.smmBoost.findMany({ where: { AND: [where(tab), q ? { content: { title: { contains: q, mode: "insensitive" } } } : {}] }, orderBy: { createdAt: "desc" }, take: TAKE, include: { content: { select: { title: true } } } }),
    Promise.all(tabs.map((t) => db.smmBoost.count({ where: where(t) }))),
    marketingSettings(),
  ]);
  const cur = st.adCurrency ?? "USD";
  return {
    key: "target", title,
    rows: list.map((b) => ({
      id: b.id, title: `Target · ${b.content.title}`,
      subtitle: `${b.days} kun × ${fmtNum(Number(b.dailyBudget), 2)} ${cur}${b.requestedByName ? ` · ${b.requestedByName}` : ""} · ${dm(b.createdAt)}`,
      right: `${fmtNum(Number(b.dailyBudget) * b.days, 2)} ${cur}`,
      status: BOOST_STATUS[b.status].label, tone: BOOST_TONE[b.status],
    })),
    filters: tabs.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], active: t.key === tab.key })),
  };
}

const MSTAT_DAYS = [7, 30, 90] as const;
const delta = (cur: number, prev: number) => (prev > 0 ? ` · ${cur >= prev ? "+" : "−"}${fmtNum(Math.abs(((cur - prev) / prev) * 100), 0)}% oldingi davrga` : "");

/** Marketing statistikasi — vebdagi `/marketing`: 7 / 30 / 90 kun. Qator bosilsa — batafsil kartochka (`mstat`). */
async function marketingList(title: string, filter?: string): Promise<MobileList> {
  const days = MSTAT_DAYS.find((d) => String(d) === filter) ?? 30;
  const a = await analytics(days);
  const rows: HomeRow[] = [];
  if (!a.account && !a.telegram) {
    rows.push({ id: `${days}~none`, title: "Profil ulanmagan", subtitle: "Instagram yoki Telegram vebda Marketing → Sozlamalar'da ulanadi", tone: "warning" });
  }
  if (a.account) {
    rows.push(
      { id: `${days}~v`, title: "Ko'rishlar", subtitle: `Instagram${a.account.username ? ` @${a.account.username}` : ""}${delta(a.totals.views, a.prev.views)}`, right: fmtNum(a.totals.views), tone: a.prev.views > 0 && a.totals.views < a.prev.views ? "warning" : "success" },
      { id: `${days}~r`, title: "Qamrov", subtitle: `noyob ko'rganlar${delta(a.totals.reach, a.prev.reach)}`, right: fmtNum(a.totals.reach) },
      { id: `${days}~i`, title: "Interaksiyalar", subtitle: "layk, izoh, saqlash, ulashish", right: fmtNum(a.totals.interactions) },
      { id: `${days}~p`, title: "Profil ko'rishlari", subtitle: `saytga o'tish: ${fmtNum(a.totals.websiteClicks)}`, right: fmtNum(a.totals.profileViews) },
      { id: `${days}~f`, title: "Obunachilar", subtitle: a.totals.followersDelta != null ? `davrda ${a.totals.followersDelta >= 0 ? "+" : "−"}${fmtNum(Math.abs(a.totals.followersDelta))}` : "o'sish hali hisoblanmagan", right: a.account.followers != null ? fmtNum(a.account.followers) : "—" },
      { id: `${days}~n`, title: "Chiqqan postlar", subtitle: `${days} kunda`, right: fmtNum(a.posts) },
    );
  }
  if (a.telegram) rows.push({ id: `${days}~tg`, title: `Telegram · ${a.telegram.name}`, subtitle: a.telegram.delta != null ? `davrda ${a.telegram.delta >= 0 ? "+" : "−"}${fmtNum(Math.abs(a.telegram.delta))}` : "obunachilar", right: a.telegram.followers != null ? fmtNum(a.telegram.followers) : "—" });
  a.top.forEach((p, i) => rows.push({
    id: `${days}~t${i}`, title: clip(p.caption, 60) || "Post", subtitle: `Eng ko'p ko'rilgan · ${MEDIA_TYPE_LABEL[p.mediaType] ?? p.mediaType} · ${dm(p.postedAt)}`,
    right: `${fmtNum(p.views)} ko'rish`, tone: "brand",
  }));
  return { key: "marketing", title: `${title} · ${days} kun`, rows, filters: MSTAT_DAYS.map((d): ListFilter => ({ key: String(d), label: `${d} kun`, active: d === days })) };
}

// ═════════════════════════ Kartochkalar ═════════════════════════

/** Sotuvga xos kartochkalar — `detail.ts` `mobileDetail` shu yerga yo'naltiradi. */
export async function sotuvDetail(user: MobileUser, card: string, id: string): Promise<MobileDetail> {
  switch (card) {
    case "offers": return offerDetail(user, id);
    case "shop": return shopDetail(user, id.split("~")[0]!);
    case "akt": return aktDetail(user, id);
    case "csite": return siteDetail(user, id);
    case "mstat": return mstatDetail(user, id);
    default: throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  }
}

/** Yangi hujjat formasini mijoz/zayavka tanlangan holda ochadigan qator (`/erp/new/<kalit>~<maydon>=<qiymat>`). */
const newRow = (key: string, params: Record<string, string>, title: string, subtitle?: string): HomeRow =>
  ({ id: [key, ...Object.entries(params).map(([k, v]) => `${k}=${v}`)].join("~"), title, subtitle, tone: "brand" });
const quickSection = (rows: HomeRow[], title = "Keyingi qadam"): HomeSection[] => (rows.length ? [{ title, empty: "", target: "new", icon: "plus", rows }] : []);

/** Ommaviy (QR) sahifaning to'liq havolasi — vebdagi taklif kartasi bilan bir xil (`APP_URL` yoki so'rov hosti). */
async function offerUrl(o: { offerNo: string; verifyToken: string }) {
  const path = offerPublicPath(o);
  try {
    const { origin } = await publicOrigin();
    return `${origin}${path}`;
  } catch {
    const env = process.env.APP_URL?.trim().replace(/\/+$/, "");
    return env ? `${env}${path}` : path;
  }
}

async function offerDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const o = await db.commercialOffer.findUnique({
    where: { id },
    include: { items: { orderBy: { sort: "asc" } }, manager: { select: { fullName: true } }, customer: { select: { id: true, name: true, isActive: true } }, order: { select: { id: true, deliveryDate: true } } },
  });
  if (!o) throw new ListError("NOT_FOUND", "Taklif topilmadi", 404);
  const st = offerState(o);
  const t = offerTotals(o.items.map((i) => ({ name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })), o.withVat, Number(o.advance));
  const url = await offerUrl(o);

  const actions: DetailAction[] = [];
  // Vebdagi kabi: amaldagi va muddati o'tgan taklif — «Mijoz qabul qildi» / «Bekor qilish»
  if ((st === "ACTIVE" || st === "EXPIRED") && can(user, "offer.accept")) {
    actions.push({ id: "offer.accept", label: "Mijoz qabul qildi", tone: "success", form: [{ name: "who", label: "Kim, qanday qabul qildi", type: "text", placeholder: "Masalan: Alisher aka, telefon orqali" }] });
  }
  if ((st === "ACTIVE" || st === "EXPIRED") && can(user, "offer.cancel")) {
    actions.push({ id: "offer.cancel", label: "Bekor qilish", tone: "danger", form: [{ name: "reason", label: "Bekor qilish sababi", type: "text", required: true, placeholder: "Narx o'zgardi / mijoz voz kechdi / xato tuzilgan…" }] });
  }
  const fields: DetailField[] = [
    { label: "Taklif", value: o.offerNo },
    { label: "Sana", value: dateRu(o.date) },
    { label: "Amal qiladi", value: `${dateRu(o.validUntil)} gacha`, tone: st === "EXPIRED" ? "warning" : undefined },
    { label: "Mijoz", value: o.clientName },
    ...(o.clientPhone ? [{ label: "Telefon", value: o.clientPhone }] : []),
    ...(o.clientInn ? [{ label: "INN", value: o.clientInn }] : []),
    ...(o.objectName ? [{ label: "Obyekt", value: o.objectName }] : []),
    ...(o.deadline ? [{ label: "Yetkazish muddati", value: o.deadline }] : []),
    { label: "Summa", value: money(t.gross) },
    ...(o.withVat ? [{ label: "Shundan QQS 12%", value: money(t.vat) }] : [{ label: "QQS", value: "qo'shilmagan" }]),
    ...(t.advance > 0 ? [{ label: "Avans", value: money(t.advance) }, { label: "Qoldiq", value: money(t.rest) }] : []),
    { label: "Menejer", value: o.manager.fullName },
    { label: "Mijoz ochdi", value: o.viewCount ? `${o.viewCount} marta${o.lastViewedAt ? ` · oxirgi ${hm(o.lastViewedAt)}` : ""}` : "hali ochmagan", tone: o.viewCount ? "success" : "warning" },
    ...(st === "ACCEPTED" ? [{ label: "Qabul qildi", value: `${o.acceptedBy ?? "—"}${o.acceptedAt ? ` · ${hm(o.acceptedAt)}` : ""}${o.acceptedNote ? ` · «${o.acceptedNote}»` : ""}`, tone: "success" as Tone }] : []),
    ...(st === "CANCELLED" ? [{ label: "Bekor qilindi", value: `${o.cancelReason ?? ""}${o.cancelledAt ? ` · ${hm(o.cancelledAt)}` : ""}`, tone: "danger" as Tone }] : []),
    ...(o.note ? [{ label: "Ichki izoh", value: o.note }] : []),
    { label: "QR havola", value: url },
  ];
  const next: HomeRow[] = [];
  if (o.customerId && o.customer?.isActive && st !== "CANCELLED" && canCreate(user, "orders")) next.push(newRow("orders", { customerId: o.customerId }, "Zayavka ochish", `${o.clientName} tanlangan holda`));
  if (canCreate(user, "offers")) next.push(newRow("offers", { copy: o.id }, "Nusxa — yangilangan narx bilan", "Qatorlar shu taklifdan olinadi"));
  const receiptTone = st === "ACCEPTED" || st === "ACTIVE" ? "success" : st === "CANCELLED" ? "danger" : "warning";
  return {
    key: "offers", id: o.id, title: o.offerNo, subtitle: o.clientName, status: OFFER_STATE[st].label,
    fields,
    sections: [
      { title: "Qatorlar", empty: "Qator yo'q", icon: "file-text", rows: t.lines.map((l, i) => ({ id: `${o.id}~${i}`, title: l.name, subtitle: `${fmtNum(l.qty, 3)} ${offerUnitLabel(l.unit)} × ${money(l.grossUnit)}`, right: money(l.gross) })) },
      ...(o.order ? [{ title: "Zayavka", empty: "", target: "orders", rows: [{ id: o.order.id, title: `${o.customer?.name ?? o.clientName} · ${dateRu(o.order.deliveryDate)}`, tone: "brand" as Tone }] }] : []),
      ...quickSection(next),
    ],
    actions,
    // Chek ko'rinishi: «QR havola» qatorini nusxalab mijozga yuborish mumkin (ilova havolani ochmaydi)
    receipt: {
      headline: money(t.gross), caption: o.clientName,
      status: { label: OFFER_STATE[st].label, tone: receiptTone, at: o.date.toISOString() },
      rows: fields.map((f) => ({ label: f.label, value: f.value, copy: f.label === "Taklif" || f.label === "QR havola" || f.label === "Telefon" })),
    },
  };
}

async function shopDetail(user: MobileUser, productId: string): Promise<MobileDetail> {
  const p = await db.product.findUnique({ where: { id: productId }, include: { shopItem: true, group: { select: { name: true } } } });
  if (!p) throw new ListError("NOT_FOUND", "Mahsulot topilmadi", 404);
  const it = p.shopItem;
  const on = !!it?.isPublished;
  const actions: DetailAction[] = [];
  if (can(user, "shop.toggle")) {
    actions.push(on
      ? { id: "shop.toggle", label: "Ilovadan yashirish", tone: "danger", confirm: "Mahsulot Insof ECO do'konida ko'rinmay qoladi. Yashirilsinmi?" }
      : { id: "shop.toggle", label: "Ilovada ko'rsatish", tone: "success", confirm: "Mahsulot Insof ECO do'konida ko'rinadi. Chiqarilsinmi?" });
  }
  if (can(user, "shop.price")) {
    actions.push({
      id: "shop.price", label: "Do'kon narxini o'zgartirish", tone: "brand",
      form: [{ name: "price", label: `Do'kon narxi (1 ${unitLabel(p.unit)}), so'm`, type: "number", value: it?.price != null ? String(Number(it.price)) : undefined, hint: `Bo'sh qoldirsangiz — bazaviy narx (${money(Number(p.price))}) ko'rinadi` }],
    });
  }
  return {
    key: "shop", id: p.id, title: it?.title?.trim() || p.name, subtitle: `${p.code}${p.group ? ` · ${p.group.name}` : ""}`, status: on ? "Ko'rinadi" : "Yashirin",
    fields: [
      { label: "Ilovada", value: on ? "Ko'rinadi" : "Yashirin", tone: on ? "success" : "warning" },
      { label: "Do'kon narxi", value: it?.price != null ? `${money(Number(it.price))} / ${unitLabel(p.unit)}` : "bazaviy narx bilan" },
      { label: "Bazaviy narx", value: `${money(Number(p.price))} / ${unitLabel(p.unit)}` },
      ...(it?.minQty != null ? [{ label: "Eng kam hajm", value: `${fmtNum(Number(it.minQty), 3)} ${unitLabel(p.unit)}` }] : []),
      ...(it?.badge ? [{ label: "Belgi", value: it.badge }] : []),
      { label: "Surat", value: it?.photo ? "bor" : "yo'q — vebda yuklanadi", tone: it?.photo ? undefined : "warning" },
      ...(it?.description ? [{ label: "Tavsif", value: clip(it.description, 600) }] : []),
    ],
    sections: [],
    actions,
  };
}

/** Akt sverki davrlari (veb sukuti — joriy yil boshidan bugungacha). */
const AKT_PERIODS = [
  { key: "year", label: "Joriy yil" }, { key: "month", label: "Joriy oy" }, { key: "prev", label: "O'tgan oy" }, { key: "12m", label: "Oxirgi 12 oy" },
] as const;
function aktRange(key: string) {
  const now = new Date();
  const end = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  if (key === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end(now) };
  if (key === "prev") return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: end(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (key === "12m") { const f = new Date(now); f.setFullYear(f.getFullYear() - 1); f.setHours(0, 0, 0, 0); return { from: f, to: end(now) }; }
  return { from: new Date(now.getFullYear(), 0, 1), to: end(now) };
}
const side = (v: number) => (v > 0.005 ? "mijoz qarzi" : v < -0.005 ? "mijoz avansi (bizning qarzimiz)" : "qoldiq yo'q");

/** Akt sverki — `lib/invoices.ts#customerStatement` (veb `/customers/[id]/akt` bilan bitta hisob). id: `<mijoz>~<davr>`. */
async function aktDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const [cid, pk0] = id.split("~");
  const pk = AKT_PERIODS.find((p) => p.key === pk0)?.key ?? "year";
  const c = await db.customer.findUnique({ where: { id: cid! }, select: { id: true, name: true, inn: true } });
  if (!c) throw new ListError("NOT_FOUND", "Mijoz topilmadi", 404);
  const { from, to } = aktRange(pk);
  const st = await customerStatement(c.id, from, to);
  const n = (v: number) => fmtNum(Math.abs(v), 2);
  return {
    key: "akt", id, title: `Akt sverki · ${AKT_PERIODS.find((p) => p.key === pk)!.label}`, subtitle: c.name,
    fields: [
      { label: "Davr", value: `${dateRu(from)} — ${dateRu(to)}` },
      { label: "Boshlang'ich qoldiq", value: `${n(st.opening)} · ${side(st.opening)}` },
      { label: "Schyotlar (debet)", value: fmtNum(st.debit, 2) },
      { label: "To'lovlar (kredit)", value: fmtNum(st.credit, 2), tone: "success" },
      { label: "Yakuniy qoldiq", value: `${n(st.closing)} · ${side(st.closing)}`, tone: st.closing > 0.005 ? "danger" : "success" },
    ],
    sections: [
      {
        title: "Hujjatlar", empty: "Davrda hujjat yo'q", icon: "file-text",
        rows: st.lines.slice(-300).map((l, i) => ({
          id: `${i}`, title: l.doc, subtitle: `${dateRu(l.date)}${l.note ? ` · ${l.note}` : ""}`,
          right: l.debit > 0 ? `+${fmtNum(l.debit, 2)}` : `−${fmtNum(l.credit, 2)}`, tone: (l.debit > 0 ? "danger" : "success") as Tone,
        })),
      },
      { title: "Boshqa davr", empty: "", target: "akt", icon: "calendar-days", rows: AKT_PERIODS.filter((p) => p.key !== pk).map((p) => ({ id: `${c.id}~${p.key}`, title: p.label })) },
    ],
    actions: [],
  };
}

/** Obyekt maydonlari — veb mijoz kartasidagi «Obyektlar» formasi (`customers/site-actions.ts`). */
const siteFields = (s?: { name: string; address: string; contactName: string | null; contactPhone: string | null; deliveryHours: string | null; instructions: string | null; isActive: boolean }): FormField[] => [
  { name: "name", label: "Obyekt nomi", type: "text", required: true, value: s?.name, placeholder: "Masalan: Yunusobod 12-uy" },
  { name: "address", label: "Manzil", type: "text", required: true, value: s?.address },
  { name: "contactName", label: "Obyektda kontakt", type: "text", value: s?.contactName ?? undefined, placeholder: "F.I.Sh." },
  { name: "contactPhone", label: "Kontakt telefoni", type: "text", value: s?.contactPhone ?? undefined, placeholder: "+998 90 123 45 67" },
  { name: "deliveryHours", label: "Qabul vaqti", type: "text", value: s?.deliveryHours ?? undefined, placeholder: "08:00–18:00" },
  { name: "instructions", label: "Haydovchiga ko'rsatma", type: "text", value: s?.instructions ?? undefined },
  ...(s ? [{ name: "isActive", label: "Faol obyekt", type: "switch" as const, value: s.isActive ? "true" : "false" }] : []),
];

/** Mijoz obyekti — qarzi (`siteDebts`), zayavkalari, tahrir/o'chirish (veb mijoz kartasi bilan bir xil). */
async function siteDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const s = await db.site.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true } } } });
  if (!s) throw new ListError("NOT_FOUND", "Obyekt topilmadi", 404);
  const [debts, orders] = await Promise.all([
    siteDebts(s.customerId),
    db.order.findMany({ where: { siteId: id }, orderBy: { date: "desc" }, take: 10, include: { items: true } }),
  ]);
  const d = debts.find((x) => x.site?.id === id);
  const actions: DetailAction[] = [];
  if (can(user, "customer.site")) actions.push({ id: "customer.site", label: "Obyektni tahrirlash", tone: "brand", form: siteFields(s) });
  if (d?.canDelete && can(user, "site.delete")) actions.push({ id: "site.delete", label: "O'chirish", tone: "danger", confirm: "Obyektda zayavka yo'q — o'chirilsinmi?" });
  return {
    key: "csite", id: s.id, title: s.name, subtitle: s.customer.name, status: s.isActive ? undefined : "Nofaol",
    fields: [
      { label: "Manzil", value: s.address },
      ...(s.contactName || s.contactPhone ? [{ label: "Kontakt", value: [s.contactName, s.contactPhone].filter(Boolean).join(", ") }] : []),
      ...(s.deliveryHours ? [{ label: "Qabul vaqti", value: s.deliveryHours }] : []),
      ...(s.instructions ? [{ label: "Ko'rsatma", value: s.instructions, tone: "warning" as Tone }] : []),
      ...(d ? [
        { label: "Yozilgan schyotlar", value: money(d.invoiced) },
        { label: "To'langan", value: money(d.paid), tone: "success" as Tone },
        { label: "Schyotsiz ochiq zayavka", value: money(d.open), tone: d.open > 0 ? "warning" as Tone : undefined },
        d.net < -0.005 ? { label: "Ortiqcha to'lov", value: money(-d.net), tone: "success" as Tone } : { label: "Qarz", value: money(d.debt), tone: (d.debt > 0 ? "danger" : "success") as Tone },
        { label: "Zayavkalar", value: String(d.orders) },
      ] : []),
      { label: "Holat", value: s.isActive ? "Faol" : "Nofaol", tone: s.isActive ? "success" : "danger" },
    ],
    sections: [
      { title: "Zayavkalar", empty: "Zayavka yo'q", target: "orders", rows: orders.map((o) => ({ id: o.id, title: `${dateRu(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""}`, right: money(o.items.reduce((a, i) => a + sum(i.qtyM3) * sum(i.price), 0)), status: o.status, tone: ORDER_TONE[o.status] })) },
      { title: "Mijoz", empty: "", target: "customers", rows: [{ id: s.customer.id, title: s.customer.name, tone: "brand" }] },
    ],
    actions,
  };
}

/** Marketing statistikasi kartochkasi (id: `<kun>[~...]`) — ko'rsatkichlar, formatlar, eng yaxshi postlar; «Yangilash». */
async function mstatDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const days = MSTAT_DAYS.find((d) => String(d) === id.split("~")[0]) ?? 30;
  const a = await analytics(days);
  const connected = !!a.account || !!a.telegram;
  return {
    key: "mstat", id: String(days), title: `Marketing · ${days} kun`, subtitle: a.account ? `Instagram${a.account.username ? ` @${a.account.username}` : ""}` : undefined,
    fields: [
      ...(a.account ? [
        { label: "Ko'rishlar", value: `${fmtNum(a.totals.views)}${delta(a.totals.views, a.prev.views)}` },
        { label: "Qamrov", value: `${fmtNum(a.totals.reach)}${delta(a.totals.reach, a.prev.reach)}` },
        { label: "Interaksiyalar", value: fmtNum(a.totals.interactions) },
        { label: "Profil ko'rishlari", value: fmtNum(a.totals.profileViews) },
        { label: "Saytga o'tish", value: fmtNum(a.totals.websiteClicks) },
        { label: "Obunachilar", value: `${a.account.followers != null ? fmtNum(a.account.followers) : "—"}${a.totals.followersDelta != null ? ` (${a.totals.followersDelta >= 0 ? "+" : "−"}${fmtNum(Math.abs(a.totals.followersDelta))})` : ""}` },
        { label: "Postlar", value: fmtNum(a.posts) },
      ] : [{ label: "Instagram", value: "ulanmagan — vebda Marketing → Sozlamalar", tone: "warning" as Tone }]),
      ...(a.telegram ? [{ label: `Telegram · ${a.telegram.name}`, value: `${a.telegram.followers != null ? fmtNum(a.telegram.followers) : "—"}${a.telegram.delta != null ? ` (${a.telegram.delta >= 0 ? "+" : "−"}${fmtNum(Math.abs(a.telegram.delta))})` : ""}` }] : []),
    ],
    sections: [
      { title: "Formatlar (90 kun)", empty: "Ma'lumot yo'q", icon: "chart-column", rows: a.byFormat.map((f) => ({ id: `f~${f.type}`, title: MEDIA_TYPE_LABEL[f.type] ?? f.type, subtitle: `${f.posts} post · o'rtacha qamrov ${fmtNum(f.avgReach)} · jalb ${fmtNum(f.engagement, 1)}%`, right: `${fmtNum(f.avgViews)} ko'rish` })) },
      { title: "Eng ko'p ko'rilgan", empty: "Davrda post yo'q", icon: "trending-up", rows: a.top.map((p) => ({ id: p.id, title: clip(p.caption, 70) || "Post", subtitle: `${MEDIA_TYPE_LABEL[p.mediaType] ?? p.mediaType} · ${dm(p.postedAt)} · ${fmtNum(p.likes)} layk · ${fmtNum(p.saves)} saqlash`, right: fmtNum(p.views), tone: "success" as Tone })) },
      ...(a.worst.length ? [{ title: "Kam ko'rilgan", empty: "", icon: "trending-down", rows: a.worst.map((p) => ({ id: p.id, title: clip(p.caption, 70) || "Post", subtitle: `${MEDIA_TYPE_LABEL[p.mediaType] ?? p.mediaType} · ${dm(p.postedAt)}`, right: fmtNum(p.views), tone: "warning" as Tone }))}] : []),
    ],
    actions: connected && can(user, "marketing.sync") ? [{ id: "marketing.sync", label: "Statistikani yangilash", tone: "brand", confirm: "Instagram va Telegram'dan so'nggi ko'rsatkichlar olinsinmi? Bir necha soniya oladi." }] : [],
  };
}

// ═════════════════════════ Mavjud kartochkalarga qo'shimchalar ═════════════════════════

type Extra = { fields: DetailField[]; sections: HomeSection[]; actions: DetailAction[]; photo?: MobileDetail["photo"] };

type OrderLite = {
  id: string; kind: string; status: OrderStatus; onCredit: boolean; guaranteeAt: Date | null; customerId: string;
  contractNo: string | null; contractAmount: unknown; contractFile: string | null; contractFileName: string | null; contractFileType: string | null;
  batches: unknown[]; trips: unknown[];
};

/**
 * Zayavka kartochkasi — veb `/orders/[id]` dagi qo'shimcha tugmalar: sklad zayavkasi (qabul, bekor, yopish),
 * kafolat xati belgisi, shartnoma (summa + imzolangan surat), tijorat taklifi. `total` — mahsulot summasi.
 */
export async function orderExtras(user: MobileUser, o: OrderLite, total: number): Promise<Extra> {
  const out: Extra = { fields: [], sections: [], actions: [] };
  if (user.role === "AGENT") return out;
  const isStock = o.kind === "STOCK";
  const noWork = o.batches.length === 0 && o.trips.length === 0;
  if (isStock) {
    if (o.status === "DRAFT" && can(user, "order.confirm-stock")) out.actions.push({ id: "order.confirm-stock", label: "Qabul qilish", tone: "success", confirm: "Sklad zayavkasi qabul qilinsinmi? Ishlab chiqarishga tushadi." });
    if (["CONFIRMED", "IN_PRODUCTION"].includes(o.status) && can(user, "order.close-stock")) out.actions.push({ id: "order.close-stock", label: "Zaxira tayyor — yopish", tone: "success", confirm: "So'ralgan mahsulot hovliga chiqarib qo'yildimi? Zayavka yopiladi." });
    if (["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status) && noWork && can(user, "order.cancel-stock")) out.actions.push({ id: "order.cancel-stock", label: "Bekor qilish", tone: "danger", form: REASON_FORM });
    return out;
  }
  if (o.onCredit && o.status !== "CANCELLED" && can(user, "order.guarantee")) {
    out.actions.push(o.guaranteeAt
      ? { id: "order.guarantee", label: "Kafolat belgisini olib tashlash", tone: "warning", confirm: "Imzolangan kafolat xati belgisi olib tashlansinmi?" }
      : { id: "order.guarantee", label: "Imzolangan xat qabul qilindi", tone: "success", confirm: "Mijoz kafolat xatini to'ldirib, imzo va muhr qo'ydimi? Xat qabul qilingan deb belgilanadi." });
  }
  const hasContract = !!o.contractNo && o.contractAmount != null;
  if (o.status !== "CANCELLED" && can(user, "order.contract")) {
    out.actions.push({
      id: "order.contract", label: hasContract ? (o.contractFile ? "Shartnomani o'zgartirish" : "Shartnoma faylini yuklash") : "Shartnoma qo'shish", tone: "brand",
      form: [
        { name: "contractAmount", label: "Shartnoma summasi (so'm)", type: "number", required: true, value: String(Math.round(hasContract ? Number(o.contractAmount) : total)) },
        { name: "contractFile", label: "Imzolangan shartnoma surati", type: "photo", hint: "Didox'da imzolangan hujjat surati — ixtiyoriy; PDF vebdan yuklanadi" },
      ],
    });
  }
  if (hasContract) {
    out.fields.push({ label: "Shartnoma fayli", value: o.contractFile ? (o.contractFileName ?? "yuklangan") : "yuklanmagan", tone: o.contractFile ? "success" : "warning" });
    const left = Number(o.contractAmount) - total;
    out.fields.push({ label: "Shartnoma qoldig'i", value: money(left), tone: left >= 0 ? "success" : "danger" });
    if (o.contractFile && o.contractFileType?.startsWith("image/")) out.photo = { url: `/api/mobile/contract?id=${o.id}`, title: `Shartnoma ${o.contractNo}` };
  }
  if (o.onCredit && o.status !== "CANCELLED") out.fields.push({ label: "Kafolat xati", value: "Chop etish — vebda «Kafolat xati» tugmasi", tone: "info" });
  if (o.status !== "CANCELLED" && canCreate(user, "offers")) out.sections.push(...quickSection([newRow("offers", { order: o.id }, "Tijorat taklifi", "Mahsulot va narxlar shu zayavkadan")]));
  return out;
}

type CustomerLite = { id: string; name: string; phone: string | null; inn: string | null; address: string | null; contactPerson: string | null; isActive: boolean; creditLimit: unknown; agentId: string | null };

/** Agentlar tanlovi — faol AGENT foydalanuvchilar (veb `/agent` biriktirish formasi). */
async function agentOptions(): Promise<FormOption[]> {
  const agents = await db.user.findMany({ where: { role: "AGENT", isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } });
  return [{ value: "none", label: "— Agentga biriktirilmagan —" }, ...agents.map((a) => ({ value: a.id, label: a.fullName }))];
}

/**
 * Mijoz kartasi — veb `/customers/[id]` dagi qo'shimchalar: tahrirlash (limit — faqat buxgalteriya/moliya/direktor),
 * obyektlar va har obyekt qarzi, to'lovlar tarixi, akt sverki, ilova hisobi, agent, «Zayavka ochish» / «Tijorat taklifi».
 */
export async function customerExtras(user: MobileUser, c: CustomerLite, blacklisted: boolean): Promise<Extra> {
  const out: Extra = { fields: [], sections: [], actions: [] };
  const office = isDirectorOr(user, ["SALES", "ACCOUNTING", "FINANCE"]);
  const payRoles: Role[] = ["CASHIER", "ACCOUNTING", "FINANCE", "SALES"];
  const canApp = can(user, "customer.app");
  const [agent, sites, payments, app] = await Promise.all([
    c.agentId ? db.user.findUnique({ where: { id: c.agentId }, select: { fullName: true } }) : null,
    office ? siteDebts(c.id) : Promise.resolve([]),
    isDirectorOr(user, payRoles) ? db.payment.findMany({ where: { customerId: c.id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 15, include: { invoice: { select: { invoiceNo: true } }, order: { select: { deliveryDate: true } }, cashAccount: { select: { name: true } }, register: { select: { id: true } } } }) : Promise.resolve([]),
    canApp ? customerAppStatus(c.id) : Promise.resolve(null),
  ]);

  if (c.contactPerson) out.fields.push({ label: "Mas'ul shaxs", value: c.contactPerson });
  if (user.role !== "AGENT") out.fields.push({ label: "Sotuv agenti", value: agent?.fullName ?? "biriktirilmagan" });
  if (app) {
    out.fields.push(app.available
      ? { label: "Ilova hisobi", value: app.linked ? `ulangan${app.org ? ` · ${app.org.name}` : ""} · ${app.members.filter((m) => m.registered).length} a'zo` : "ulanmagan", tone: app.linked ? "success" : "warning" }
      : { label: "Ilova hisobi", value: app.message, tone: "info" });
  }

  // ── Bo'limlar ──
  const real = sites.filter((s) => s.site);
  if (office) {
    out.sections.push({
      title: "Obyektlar", empty: "Obyekt qo'shilmagan", target: "csite", icon: "building",
      rows: real.map((s) => ({
        id: s.site!.id, title: s.site!.name, subtitle: `${s.site!.address}${s.orders ? ` · ${s.orders} zayavka` : ""}`,
        right: s.net < -0.005 ? `avans ${money(-s.net)}` : money(s.debt), status: s.site!.isActive ? undefined : "Nofaol",
        tone: (!s.site!.isActive ? "info" : s.debt > 0 ? "danger" : "success") as Tone,
      })),
    });
    const none = sites.find((s) => !s.site);
    if (none && Math.abs(none.net) > 0.005) out.fields.push({ label: "Obyektsiz zayavkalar qarzi", value: none.net < 0 ? `avans ${money(-none.net)}` : money(none.debt) });
  }
  if (payments.length || isDirectorOr(user, payRoles)) {
    out.sections.push({
      title: "To'lovlar", empty: "To'lov yo'q", target: "payments",
      rows: payments.map((p) => ({
        id: p.id, title: `+${money(sum(p.amount))}`,
        subtitle: `${dateRu(p.date)} · ${p.invoice ? `schyot ${p.invoice.invoiceNo}` : p.register ? "realizatsiya" : p.order ? `avans · zayavka ${dateRu(p.order.deliveryDate)}` : "taqsimlanmagan"} · ${p.cashAccount.name}`,
        tone: "success" as Tone,
      })),
    });
  }
  if (office) {
    out.sections.push({ title: "Akt sverki", empty: "", target: "akt", icon: "scale", rows: AKT_PERIODS.map((p) => ({ id: `${c.id}~${p.key}`, title: p.label, subtitle: "Schyotlar va to'lovlar solishtiruvi" })) });
  }
  const next: HomeRow[] = [];
  if (c.isActive && !blacklisted && canCreate(user, "orders") && (user.role !== "AGENT" || c.agentId === user.id)) next.push(newRow("orders", { customerId: c.id }, "Zayavka ochish", `${c.name} tanlangan holda`));
  if (c.isActive && canCreate(user, "offers")) next.push(newRow("offers", { customerId: c.id }, "Tijorat taklifi", "Mijoz rekvizitlari o'zi to'ladi"));
  out.sections.push(...quickSection(next, "Yangi hujjat"));

  // ── Amallar ──
  if (can(user, "customer.edit")) {
    const lim = Number(c.creditLimit);
    out.actions.push({
      id: "customer.edit", label: "Tahrirlash", tone: "brand",
      form: [
        { name: "name", label: "Nomi", type: "text", required: true, value: c.name },
        { name: "phone", label: "Telefon", type: "text", value: c.phone ?? undefined, placeholder: "+998 90 123 45 67" },
        { name: "inn", label: "INN", type: "text", value: c.inn ?? undefined, placeholder: "9 yoki 14 raqam" },
        { name: "address", label: "Manzil", type: "text", value: c.address ?? undefined },
        { name: "contactPerson", label: "Mas'ul shaxs", type: "text", value: c.contactPerson ?? undefined },
        // Limit — faqat buxgalteriya/moliya/direktor (veb bilan bir xil). Maydon nomida forma ochilgandagi limit (tiyinda):
        // shu orada boshqa joyda o'zgargan limit eski forma bilan orqaga qaytmasin (vebdagi `creditLimitWas`)
        ...(canSetCreditLimit(user.role) ? [{ name: `creditLimit_${Math.round(lim * 100)}`, label: "Kredit limiti (so'm)", type: "number" as const, value: String(lim), hint: "0 — faqat naqd / avans" }] : []),
        { name: "isActive", label: "Faol mijoz", type: "switch", value: c.isActive ? "true" : "false" },
      ],
    });
  }
  if (office && can(user, "customer.site")) out.actions.push({ id: "customer.site", label: "Obyekt qo'shish", tone: "brand", form: siteFields() });
  if (can(user, "customer.agent")) {
    out.actions.push({ id: "customer.agent", label: "Agentga biriktirish", tone: "brand", form: [{ name: "agentId", label: "Sotuv agenti", type: "select", required: true, value: c.agentId ?? "none", options: await agentOptions() }] });
  }
  if (app?.available && !app.linked && canApp) {
    const [byPhone, any] = await Promise.all([c.phone ? findAppCandidates(c.phone) : Promise.resolve({ items: [] }), findAppCandidates(c.name.slice(0, 40))]);
    const seen = new Set<string>();
    const opts: FormOption[] = [...byPhone.items, ...any.items].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true))).slice(0, 30).map((o) => ({
      value: o.id, label: o.name, hint: `${o.members.map((m) => `${m.fullName ?? ""} ${m.phone}`.trim()).join(", ") || "a'zosiz"}${o.inn ? ` · INN ${o.inn}` : ""}`,
    }));
    if (opts.length) out.actions.push({ id: "customer.app", label: "Ilova hisobini ulash", tone: "brand", form: [{ name: "orgId", label: "Ilovada ro'yxatdan o'tgan tashkilot", type: "select", required: true, options: opts, hint: "Mijoz ilovada o'z zayavkalari va reyslarini ko'radi" }] });
  }
  return out;
}

/** Sayt arizasi — mijozga aylangandan keyin «Zayavka ochish», va «Tijorat taklifi» (veb `/leads` bilan bir xil). */
export function leadExtras(user: MobileUser, l: { id: string; status: string; customerId: string | null }): HomeSection[] {
  const rows: HomeRow[] = [];
  if (l.customerId && canCreate(user, "orders")) rows.push(newRow("orders", { customerId: l.customerId, lead: l.id }, "Zayavka ochish", "Mahsulot, hajm va manzil arizadan"));
  if (l.status !== "REJECTED" && canCreate(user, "offers")) rows.push(newRow("offers", { lead: l.id }, "Tijorat taklifi", "Ism, telefon va mahsulot arizadan"));
  return quickSection(rows);
}

/**
 * Kontent kartochkasi (`smm`) — sotuv uchun: tasdiqqa yuborish, hozir chiqarish (faqat «publish» ruxsati bilan),
 * nashrlar holati, target so'rovi va so'rovlar ro'yxati (veb `/marketing/kontent/[id]`).
 */
export async function smmExtras(user: MobileUser, id: string): Promise<Extra> {
  const out: Extra = { fields: [], sections: [], actions: [] };
  const c = await db.marketingContent.findUnique({ where: { id }, include: { publications: true, boosts: { orderBy: { createdAt: "desc" } } } });
  if (!c) return out;
  const open = c.status !== "CANCELLED" && c.status !== "PUBLISHED";
  if (open && (c.approval === "DRAFT" || c.approval === "REJECTED") && can(user, "smm.submit")) {
    out.actions.push({ id: "smm.submit", label: "Tasdiqlashga yuborish", tone: "brand", confirm: "Post direktor tasdig'iga yuborilsinmi? Matn, tarmoq va media tekshiriladi." });
  }
  const failed = c.publications.some((p) => p.status === "FAILED");
  if (c.approval === "APPROVED" && c.status !== "CANCELLED" && (c.status !== "PUBLISHED" || failed) && can(user, "smm.publish")) {
    out.actions.push({ id: "smm.publish", label: failed ? "Xato tarmoqlarga qayta yuborish" : "Hozir chiqarish", tone: "success", confirm: "Post tanlangan tarmoqlarga kompaniya nomidan hozir chiqariladi. Davom etilsinmi?" });
  }
  const ig = c.publications.find((p) => p.channel === "INSTAGRAM");
  if (ig && (ig.status === "PUBLISHED" || ig.status === "SIMULATED") && can(user, "boost.request")) {
    const st = await marketingSettings();
    out.actions.push({
      id: "boost.request", label: "Target qilish", tone: "brand",
      form: [
        { name: "objective", label: "Maqsad", type: "select", required: true, value: "REACH", options: (Object.keys(BOOST_OBJECTIVE) as SmmBoostObjective[]).map((k) => ({ value: k, label: BOOST_OBJECTIVE[k].label, hint: BOOST_OBJECTIVE[k].hint })) },
        { name: "audience", label: "Auditoriya", type: "select", required: true, value: AUDIENCES[0]?.key, options: AUDIENCES.map((a) => ({ value: a.key, label: a.label, hint: a.hint })) },
        { name: "dailyBudget", label: `Kunlik byudjet, ${st.adCurrency ?? "USD"}`, type: "number", required: true, value: "5", hint: `Limit ${Number(st.boostDailyCap)} ${st.adCurrency ?? "USD"} · direktor tasdiqlagach ishga tushadi` },
        { name: "days", label: "Necha kun (1–30)", type: "number", required: true, value: "5" },
        { name: "note", label: "Izoh", type: "text", placeholder: "Nega shu post? (ixtiyoriy)" },
      ],
    });
  }
  if (c.publications.length) {
    out.sections.push({
      title: "Nashrlar", empty: "", icon: "send",
      rows: c.publications.map((p) => ({ id: p.id, title: CHANNEL_LABEL[p.channel], subtitle: p.error ? clip(p.error, 160) : p.publishedAt ? hm(p.publishedAt) : undefined, right: p.views != null ? `${fmtNum(p.views)} ko'rish` : undefined, status: PUB_STATUS[p.status].label, tone: (p.status === "PUBLISHED" ? "success" : p.status === "FAILED" ? "danger" : "info") as Tone })),
    });
  }
  if (c.boosts.length) {
    out.sections.push({
      title: "Target so'rovlari", empty: "", target: "boost",
      rows: c.boosts.map((b) => ({ id: b.id, title: `${b.days} kun × ${fmtNum(Number(b.dailyBudget), 2)}`, subtitle: `${b.requestedByName ?? ""} · ${dm(b.createdAt)}`, status: BOOST_STATUS[b.status].label, tone: BOOST_TONE[b.status] })),
    });
  }
  return out;
}

/** Target kartochkasi (`boost`) — natijalar va to'xtatish / davom ettirish (`boost_approve`). */
export async function boostExtras(user: MobileUser, id: string): Promise<Extra> {
  const out: Extra = { fields: [], sections: [], actions: [] };
  const b = await db.smmBoost.findUnique({ where: { id } });
  if (!b) return out;
  out.fields.push({ label: "Holat", value: BOOST_STATUS[b.status].label, tone: BOOST_TONE[b.status] });
  if (b.statsAt || Number(b.spend) > 0) {
    out.fields.push(
      { label: "Sarflandi", value: fmtNum(Number(b.spend), 2) },
      { label: "Ko'rsatildi / qamrov", value: `${fmtNum(b.impressions)} / ${fmtNum(b.reach)}` },
      { label: "Bosishlar / natija", value: `${fmtNum(b.clicks)} / ${fmtNum(b.results)}` },
    );
  }
  out.sections.push({ title: "Post", empty: "", target: "smm", rows: [{ id: b.contentId, title: "Kontent kartochkasi", tone: "brand" }] });
  if (b.startAt || b.endAt) out.fields.push({ label: "Davr", value: `${b.startAt ? dateRu(b.startAt) : "—"} — ${b.endAt ? dateRu(b.endAt) : "—"}` });
  if (b.metaCampaignId && (b.status === "ACTIVE" || b.status === "PAUSED") && can(user, "boost.toggle")) {
    out.actions.push(b.status === "ACTIVE"
      ? { id: "boost.toggle", label: "To'xtatish", tone: "warning", confirm: "Reklama Meta'da to'xtatilsinmi? Keyin davom ettirish mumkin." }
      : { id: "boost.toggle", label: "Davom ettirish", tone: "success", confirm: "Reklama yana ishga tushirilsinmi? Pul sarflanishi davom etadi." });
  }
  return out;
}

// ═════════════════════════ Amallar ═════════════════════════

/** `runMobileAction` shu kalitlarni shu yerga beradi (`order.confirm` — sklad zayavkasi bo'lsa, `order.cancel` — sabab bilan). */
export const SOTUV_ACTIONS: ReadonlySet<string> = new Set([...Object.keys(SOTUV_ACTION_ROLES), "order.cancel", "order.confirm"]);

/** Mijoz kartasidan obyekt: `id` — obyekt (tahrir) yoki mijoz (yangi obyekt). */
async function customerSiteSave(user: MobileUser, id: string, p: Record<string, unknown>): Promise<string> {
  const site = await db.site.findUnique({ where: { id }, select: { id: true, customerId: true, isActive: true } });
  const input = {
    name: textOf(p, "name"), address: textOf(p, "address"),
    contactName: textOf(p, "contactName") || null, contactPhone: textOf(p, "contactPhone") || null,
    deliveryHours: textOf(p, "deliveryHours") || null, instructions: textOf(p, "instructions") || null,
    isActive: boolOf(p, "isActive", site ? site.isActive : true),
  };
  const r = await saveCustomerSite(site ? site.customerId : id, site ? site.id : null, input, user.id);
  if (!r.ok) fail(r.error);
  return site ? "Obyekt saqlandi" : "Obyekt qo'shildi";
}

export async function runSotuvAction(user: MobileUser, action: string, id: string, p: Record<string, unknown>): Promise<ActionResult | null> {
  if (!SOTUV_ACTIONS.has(action)) return null;
  const ok = (message: string): ActionResult => ({ ok: true, message });
  const orderKind = async () => {
    const o = await db.order.findUnique({ where: { id }, select: { kind: true } });
    if (!o) return fail("Zayavka topilmadi", 404);
    return o.kind;
  };
  // Agent uchun hech bir qo'shimcha amal yo'q (ruxsat jadvalida ham), bu yerda ham — qo'lda yuborilgan so'rov uchun
  if (user.role === "AGENT") fail("Bu amalga ruxsatingiz yo'q", 403);
  switch (action) {
    // ── Zayavka: sklad zayavkasi veb kabi `stock` ruxsati bilan ──
    case "order.confirm":
    case "order.confirm-stock": {
      const kind = await orderKind();
      if (action === "order.confirm" && kind !== "STOCK") return null; // mijoz zayavkasi — `actions.ts` dagi oddiy yo'l
      if (kind !== "STOCK") fail("Bu mijoz zayavkasi — «Qabul qilish» tugmasidan foydalaning");
      if (!can(user, "order.confirm-stock")) fail("Sklad zayavkasini qabul qilishga ruxsatingiz yo'q", 403);
      const r = await orderConfirm(id, user.id);
      if (r.error) fail(r.error);
      return ok("Sklad zayavkasi qabul qilindi — ishlab chiqarishga tushdi");
    }
    case "order.cancel":
    case "order.cancel-stock": {
      const kind = await orderKind();
      const stock = kind === "STOCK";
      if (action === "order.cancel-stock" && !stock) fail("Bu mijoz zayavkasi");
      if (stock && !can(user, "order.cancel-stock")) fail("Sklad zayavkasini bekor qilishga ruxsatingiz yo'q", 403);
      const r = await cancelOrderWithReason(id, textOf(p, "reason"), user.id);
      if (!r.ok) fail(r.error);
      return ok("Zayavka bekor qilindi");
    }
    case "order.close-stock": {
      const r = await closeStockOrderLib(id, user.id);
      if (!r.ok) fail(r.error);
      return ok(r.note ?? "Yopildi");
    }
    case "order.guarantee": {
      const o = await db.order.findUnique({ where: { id }, select: { kind: true, onCredit: true, guaranteeAt: true } });
      if (!o) fail("Zayavka topilmadi", 404);
      if (o!.kind === "STOCK" || !o!.onCredit) fail("Kafolat xati faqat qarzga zayavkada");
      const r = await setGuarantee(id, !o!.guaranteeAt, user.id);
      if (!r.ok) fail(r.error);
      return ok(r.note ?? "Saqlandi");
    }
    case "order.contract": {
      if ((await orderKind()) === "STOCK") fail("Sklad zayavkasiga shartnoma qo'shilmaydi");
      const raw = textOf(p, "contractFile");
      const file = raw ? dataUrlFile(raw, "shartnoma") : null;
      if (raw && !file) fail("Surat o'qilmadi — qayta oling");
      const r = await setOrderContract(id, numOf(p, "contractAmount"), file, user.id);
      if (!r.ok) fail(r.error);
      return ok(r.note ?? "Shartnoma saqlandi");
    }

    // ── Mijoz ──
    case "customer.edit": {
      const cur = await db.customer.findUnique({ where: { id }, select: { creditLimit: true } });
      if (!cur) fail("Mijoz topilmadi", 404);
      if (!textOf(p, "name")) fail("Nomi to'ldirilishi shart");
      const curLimit = Number(cur!.creditLimit);
      // Limit maydoni `creditLimit_<forma ochilgandagi limit, tiyinda>` — faqat limit huquqi bor rolga chiqadi
      const limKey = canSetCreditLimit(user.role) ? Object.keys(p).find((k) => /^creditLimit_\d+$/.test(k)) : undefined;
      const was = limKey ? Number(limKey.slice("creditLimit_".length)) / 100 : curLimit;
      const typed = limKey ? numOf(p, limKey) : NaN;
      if (limKey && textOf(p, limKey) && !(typed >= 0)) fail("Kredit limiti raqam bo'lsin");
      const r = await saveCustomerLib(id, {
        name: textOf(p, "name"), inn: textOf(p, "inn") || null, phone: textOf(p, "phone") || null, address: textOf(p, "address") || null,
        contactPerson: textOf(p, "contactPerson") || null, creditLimit: Number.isFinite(typed) ? typed : was, isActive: boolOf(p, "isActive", true),
      }, { userId: user.id, role: user.role }, String(was));
      if (!r.ok) fail(r.error);
      syncCustomerLater(id);
      return ok("Mijoz kartasi saqlandi");
    }
    case "customer.site": return ok(await customerSiteSave(user, id, p));
    case "site.delete": {
      const s = await db.site.findUnique({ where: { id }, select: { customerId: true } });
      if (!s) fail("Obyekt topilmadi", 404);
      const r = await deleteCustomerSite(s!.customerId, id, user.id);
      if (!r.ok) fail(r.error);
      return ok("Obyekt o'chirildi");
    }
    case "customer.agent": {
      const v = textOf(p, "agentId");
      const r = await assignCustomerAgentLib(id, v === "none" ? "" : v, user.id);
      if (!r.ok) fail(r.error);
      return ok(r.note);
    }
    case "customer.app": {
      const orgId = textOf(p, "orgId");
      if (!orgId) fail("Tashkilotni tanlang");
      const r = await linkCustomerApp(id, orgId, user.id);
      if (!r.ok) fail(r.error);
      return ok("Mijoz ilova hisobiga ulandi");
    }

    // ── Tijorat taklifi ──
    case "offer.cancel": {
      const r = await cancelOffer(id, textOf(p, "reason"), user.id);
      if (!r.ok) fail(r.error);
      return ok("Taklif bekor qilindi");
    }
    case "offer.accept": {
      const r = await acceptOfferByManager(id, user.id, textOf(p, "who"));
      if (!r.ok) fail(r.error);
      return ok("Taklif qabul qilingan deb belgilandi");
    }

    // ── E-commerce ──
    case "shop.toggle": {
      const it = await db.shopItem.findUnique({ where: { productId: id }, select: { isPublished: true } });
      if (!(await db.product.count({ where: { id } }))) fail("Mahsulot topilmadi", 404);
      const on = !it?.isPublished;
      await setShopItemPublished(id, on, user.id);
      return ok(on ? "Mahsulot ilovada ko'rinadi" : "Mahsulot ilovadan yashirildi");
    }
    case "shop.price": {
      const raw = textOf(p, "price");
      const price = raw ? numOf(p, "price") : null;
      if (raw && !(price! >= 0)) fail("Narx raqam bo'lishi kerak");
      const r = await setShopItemPrice(id, price, user.id);
      if (!r.ok) fail(r.error);
      return ok(price == null ? "Do'kon narxi olib tashlandi — bazaviy narx ko'rinadi" : `Do'kon narxi: ${money(price)}`);
    }

    // ── Marketing ──
    case "smm.submit": {
      const r = await submitContent(id, { userId: user.id, name: user.fullName });
      if (!r.ok) fail(r.error);
      return ok("Tasdiqlashga yuborildi — direktorga xabar ketdi");
    }
    case "smm.publish": {
      let outcomes: Awaited<ReturnType<typeof publishContent>> = [];
      try { outcomes = await publishContent(id, user.id); } catch (e) { fail(e instanceof Error ? e.message : "Nashr xatosi"); }
      const failed = outcomes.filter((o) => o.status === "FAILED");
      if (failed.length) fail(failed.map((f) => `${CHANNEL_LABEL[f.channel]}: ${f.message}`).join("; "));
      const sim = outcomes.filter((o) => o.status === "SIMULATED");
      return ok(sim.length ? `Sinov: ${sim.map((o) => o.message).join("; ")}` : "Chiqarildi");
    }
    case "boost.request": {
      const objective = textOf(p, "objective") as SmmBoostObjective;
      if (!Object.hasOwn(BOOST_OBJECTIVE, objective)) fail("Maqsadni tanlang");
      const days = numOf(p, "days");
      if (!Number.isInteger(days) || days < 1 || days > 30) fail("Kun 1 dan 30 gacha butun son bo'lsin");
      const daily = numOf(p, "dailyBudget");
      if (!(daily >= 0.01)) fail("Kunlik byudjet 0 dan katta bo'lsin");
      const r = await requestBoost({ contentId: id, objective, audience: textOf(p, "audience"), dailyBudget: daily, days, note: textOf(p, "note") || null }, { userId: user.id, name: user.fullName });
      if (!r.ok) fail(r.error);
      return ok("So'rov yuborildi — direktor tasdiqlagach ishga tushadi");
    }
    case "boost.toggle": {
      const b = await db.smmBoost.findUnique({ where: { id }, select: { status: true } });
      if (!b) fail("Reklama topilmadi", 404);
      if (b!.status !== "ACTIVE" && b!.status !== "PAUSED") fail("Holat o'zgargan — kartochkani yangilang");
      const to = b!.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
      const r = await toggleBoost(id, to, { userId: user.id, name: user.fullName });
      if (!r.ok) fail(r.error);
      return ok(to === "PAUSED" ? "Reklama to'xtatildi" : "Reklama davom ettirildi");
    }
    case "marketing.sync": {
      const r = await syncMarketingNow();
      if (!r.ok) fail(r.error);
      return ok(r.note);
    }
    default:
      return null;
  }
}

// ═════════════════════════ Formalar ═════════════════════════

/**
 * Formani oldindan to'ldirish (backward-compatible): ilova `/erp/new/<kalit>` ni ochadi, kalit `~` bilan parametr olib kelishi mumkin:
 * `orders~customerId=<id>~lead=<id>`, `offers~order=<id>`, `trips~orderId=<id>`. Server formani asosiy kalit bilan quradi va
 * parametr nomi forma maydoni nomiga teng bo'lsa — uning boshlang'ich qiymatini qo'yadi (`applyFormDefaults`). Forma javobidagi
 * `key` — asosiy kalit, shuning uchun saqlash (`/create`) o'zgarmaydi. Eski ilova ham ishlaydi: u kalitni o'zgartirmay yuboradi.
 */
export function splitFormKey(raw: string): { key: string; defaults: Record<string, string> } {
  const [key = "", ...parts] = String(raw ?? "").split("~");
  const defaults: Record<string, string> = {};
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i), v = part.slice(i + 1).trim();
    if (/^[A-Za-z][\w-]{0,40}$/.test(k) && v && v.length <= 200 && !Object.hasOwn(Object.prototype, k)) defaults[k] = v;
  }
  return { key, defaults };
}

/** Parametrlar — oddiy maydonlarning boshlang'ich qiymati. Tanlovda bunday variant bo'lmasa (masalan agentning begona mijozi) — qo'yilmaydi. */
export function applyFormDefaults<T extends CreateForm>(form: T, defaults: Record<string, string>): T {
  if (!Object.keys(defaults).length) return form;
  return {
    ...form,
    fields: form.fields.map((f) => {
      const v = Object.hasOwn(defaults, f.name) ? defaults[f.name] : undefined;
      if (v == null || f.type === "items" || f.type === "photo") return f;
      if (f.type === "select" && !f.options?.some((o) => o.value === v)) return f;
      return { ...f, value: v };
    }),
  };
}

/** Sayt arizasidan zayavka: mahsulot, hajm, manzil va izoh (veb `/orders/new?lead=` bilan bir xil). */
export async function leadOrderPrefill(leadId: string | undefined, customerId: string | undefined) {
  if (!leadId) return null;
  const l = await db.lead.findUnique({ where: { id: leadId }, select: { productId: true, qty: true, address: true, message: true, customerId: true, product: { select: { price: true } } } });
  if (!l || (customerId && l.customerId && l.customerId !== customerId)) return null;
  return {
    productId: l.productId, qty: l.qty != null ? String(Number(l.qty)) : undefined, price: l.product ? String(Math.round(Number(l.product.price))) : undefined,
    address: l.address ?? undefined, note: ["Sayt arizasidan", l.message].filter(Boolean).join(": "),
  };
}

const tomorrowYmd = () => { const d = new Date(); d.setDate(d.getDate() + 1); return isoDate(d); };

/** Sklad (zaxira) zayavkasi — veb `stock-order-form.tsx`: mijozsiz, narxsiz; faqat dona mahsulot (beton zakaz bilan tayyorlanadi). */
export async function stockOrderForm(): Promise<CreateForm> {
  const catalog = await productCatalog({ pieceOnly: true });
  return {
    key: "stock-order", title: "Sklad zayavkasi", submitLabel: "Zayavkani ochish",
    fields: [
      { name: "dueDate", label: "Tayyor bo'lish muddati", type: "date", required: true, value: tomorrowYmd(), hint: "Shu sanaga zaxira hovlida turishi kerak" },
      {
        name: "items", label: "Mahsulot", type: "items", required: true,
        columns: [
          { name: "productId", label: "Mahsulot", type: "select", required: true, options: catalog.products.map((p) => { const path = groupPath(catalog.groups, p.groupId); return { value: p.id, label: `${path ? `${path} › ` : ""}${p.name} · ${p.unit}` }; }) },
          { name: "qty", label: "Miqdori", type: "number", required: true, placeholder: "0" },
        ],
      },
      { name: "isUrgent", label: "Zarur (shoshilinch)", type: "switch", value: "false" },
      { name: "note", label: "Izoh", type: "text", placeholder: "Nega zaxira kerak: kutilayotgan buyurtma, mavsum, obyekt nomi" },
    ],
  };
}

/** Taklif amal qilish muddati tanlovi (ilovaning sana maydoni faqat 14 kun oldinni ko'rsatadi). */
function validityOptions(validDays: number): { options: FormOption[]; value: string } {
  const base = new Date(`${offerToday()}T00:00:00.000Z`);
  const days = [...new Set([7, 10, 14, 30, 45, 60, 90, validDays])].filter((d) => d >= 1 && d <= 365).sort((a, b) => a - b);
  const at = (n: number) => new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return {
    options: days.map((d) => ({ value: at(d), label: `${d} kun · ${at(d).split("-").reverse().join(".")} gacha` })),
    value: at(validDays),
  };
}

type OfferPrefill = { customerId?: string | null; clientName?: string; clientPhone?: string | null; clientInn?: string | null; objectName?: string | null; note?: string; basis?: FormOption; items?: { productId: string | null; name: string; unit: string; qty: number; price: number }[] };

/** Qayerdan ochilganiga qarab to'ldirish — veb `/takliflar/new` (`?order=`, `?copy=`, `?lead=`, `?customer=`). */
async function offerPrefill(d: Record<string, string>): Promise<OfferPrefill | null> {
  if (d.order) {
    const o = await db.order.findUnique({ where: { id: d.order }, include: { customer: true, items: { include: { product: true } } } });
    if (!o || o.kind !== "SALE") return null;
    const net = (price: unknown, nds: boolean) => (nds ? Math.round((Number(price) / 1.12) * 100) / 100 : Number(price));
    return {
      customerId: o.customerId, clientName: o.customer.name, clientPhone: o.customer.phone, clientInn: o.customer.inn, objectName: o.deliveryAddress,
      note: `Zayavka asosida (${dateRu(o.deliveryDate)})`, basis: { value: `order:${o.id}`, label: `Zayavka asosida · ${o.customer.name} · ${dateRu(o.deliveryDate)}` },
      items: o.items.map((i) => ({ productId: i.productId, name: i.product.name, unit: i.product.unit, qty: Number(i.qtyM3), price: net(i.price, i.nds) })),
    };
  }
  if (d.copy) {
    const o = await db.commercialOffer.findUnique({ where: { id: d.copy }, include: { items: { orderBy: { sort: "asc" } } } });
    if (!o) return null;
    return {
      customerId: o.customerId, clientName: o.clientName, clientPhone: o.clientPhone, clientInn: o.clientInn, objectName: o.objectName, note: `${o.offerNo} dan nusxa`,
      basis: o.orderId ? { value: `order:${o.orderId}`, label: `${o.offerNo} dan nusxa` } : o.leadId ? { value: `lead:${o.leadId}`, label: `${o.offerNo} dan nusxa` } : undefined,
      items: o.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })),
    };
  }
  if (d.lead) {
    const l = await db.lead.findUnique({ where: { id: d.lead }, include: { product: true, customer: true } });
    if (!l) return null;
    return {
      customerId: l.customerId, clientName: l.customer?.name ?? l.name, clientPhone: l.phone, clientInn: l.customer?.inn ?? null, objectName: l.address,
      note: "Sayt arizasi asosida", basis: { value: `lead:${l.id}`, label: "Sayt arizasi asosida" },
      items: l.product ? [{ productId: l.product.id, name: l.product.name, unit: l.product.unit, qty: l.qty ? Number(l.qty) : 0, price: Number(l.product.price) }] : undefined,
    };
  }
  if (d.customerId) {
    const c = await db.customer.findUnique({ where: { id: d.customerId }, select: { id: true, name: true, phone: true, inn: true, address: true, isInternal: true } });
    if (!c || c.isInternal) return null;
    return { customerId: c.id, clientName: c.name, clientPhone: c.phone, clientInn: c.inn, objectName: c.address };
  }
  return null;
}

/** Yangi tijorat taklifi — veb `offer-form.tsx` maydonlari. Kirish matni va shartlar — Sozlamalardagi standart (vebda tahrirlanadi). */
export async function offerForm(defaults: Record<string, string>): Promise<CreateForm> {
  const [catalog, def, customers, pre] = await Promise.all([
    productCatalog(),
    offerDefaults(),
    db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, inn: true, address: true } }),
    offerPrefill(defaults),
  ]);
  const v = validityOptions(def.validDays);
  const first = pre?.items?.[0];
  const unitOpts = OFFER_UNITS.map(([value, label]) => ({ value, label }));
  const rawUnit = (u: string) => (OFFER_UNITS.some(([k]) => k === u) ? u : "dona");
  return {
    key: "offers", title: "Yangi tijorat taklifi", submitLabel: "Taklifni saqlash",
    fields: [
      ...(pre?.basis ? [{ name: "basis", label: "Asos", type: "select" as const, value: pre.basis.value, options: [pre.basis] }] : []),
      {
        name: "customerId", label: "Mijoz (bazadan)", type: "select", value: pre?.customerId ?? undefined,
        options: customers.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined, extra: { clientName: c.name, ...(c.phone ? { clientPhone: c.phone } : {}), ...(c.inn ? { clientInn: c.inn } : {}), ...(c.address ? { objectName: c.address } : {}) } })),
        hint: "Tanlansa nom, telefon va INN o'zi to'ladi; potensial xaridor bo'lsa — bo'sh qoldiring",
      },
      { name: "clientName", label: "Mijoz / tashkilot nomi", type: "text", required: true, value: pre?.clientName, placeholder: "«Qurilish Invest» MChJ yoki Alisher aka" },
      { name: "clientPhone", label: "Telefon", type: "text", value: pre?.clientPhone ?? undefined, placeholder: "+998 90 123 45 67" },
      { name: "clientInn", label: "INN (ixtiyoriy)", type: "text", value: pre?.clientInn ?? undefined },
      { name: "objectName", label: "Obyekt", type: "text", value: pre?.objectName ?? undefined, placeholder: "Qurilish joyi" },
      { name: "deadline", label: "Yetkazish muddati", type: "text", placeholder: "Masalan: tasdiqlangandan keyin 10 kun ichida" },
      { name: "validUntil", label: "Taklif amal qiladi", type: "select", required: true, value: v.value, options: v.options, hint: `Sozlamadagi standart: ${def.validDays} kun` },
      { name: "lang", label: "Hujjat tili", type: "select", required: true, value: "uz", options: [{ value: "uz", label: "O'zbekcha" }, { value: "ru", label: "Ruscha (Русский)" }] },
      { name: "withVat", label: "Narxlarga QQS 12% qo'shiladi", type: "switch", value: def.withVat ? "true" : "false" },
      {
        name: "items", label: "Qatorlar", type: "items", required: true,
        hint: "Narx — QQS'siz, 1 birlik uchun",
        // Bir nechta qator (zayavka yoki nusxadan) — yangi ilova `rows` ni oladi; eski ilova birinchi qatorni ustun qiymatidan oladi
        rows: pre?.items?.length ? pre.items.map((i) => ({ productId: i.productId ?? "", name: i.name, unit: rawUnit(i.unit), qty: i.qty ? String(i.qty) : "", price: String(i.price) })) : undefined,
        columns: [
          {
            name: "productId", label: "Katalogdan (ixtiyoriy)", type: "select", value: first?.productId ?? undefined,
            options: catalog.products.map((p) => { const path = groupPath(catalog.groups, p.groupId); return { value: p.id, label: `${path ? `${path} › ` : ""}${p.name} · ${p.unit}`, extra: { name: p.name, unit: rawUnit(p.rawUnit), price: String(Math.round(Number(p.price))) } }; }),
          },
          { name: "name", label: "Hujjatdagi nomi", type: "text", required: true, value: first?.name, placeholder: "Masalan: 2PK 39-10-8 A400" },
          { name: "unit", label: "Birlik", type: "select", value: first ? rawUnit(first.unit) : undefined, options: unitOpts },
          { name: "qty", label: "Soni", type: "number", required: true, value: first?.qty ? String(first.qty) : undefined, placeholder: "0" },
          { name: "price", label: "Narxi (QQS'siz)", type: "number", required: true, value: first ? String(first.price) : undefined, placeholder: "0" },
        ],
      },
      { name: "advance", label: "Avans (kutilayotgan bosh to'lov), so'm", type: "number", placeholder: "0" },
      { name: "note", label: "Ichki izoh", type: "text", value: pre?.note, hint: "Mijoz ko'rmaydi" },
    ],
  };
}

type Row = Record<string, unknown>;
const rowsOf = (p: Record<string, unknown>) => (Array.isArray(p.items) ? (p.items as Row[]) : []);
const cell = (r: Row, k: string) => String(r[k] ?? "").trim();
const cellNum = (r: Row, k: string) => Number(cell(r, k).replace(/\s+/g, "").replace(",", "."));

/** Sotuv formalari (`stock-order`, `offers`) — `create.ts` `mobileCreate` shu yerga beradi. Xato — `Error` (matni ko'rsatiladi). */
export async function sotuvCreate(user: MobileUser, key: string, raw: unknown): Promise<CreateResult> {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (key === "stock-order") {
    const due = textOf(p, "dueDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("Tayyor bo'lish muddati kerak");
    const items = rowsOf(p).map((r) => ({ productId: cell(r, "productId"), qtyM3: cellNum(r, "qty") }));
    if (items.some((i) => i.productId && !(i.qtyM3 > 0))) throw new Error("Miqdor 0 dan katta bo'lsin");
    const r = await createStockOrder({ dueDate: new Date(`${due}T00:00:00`), items: items.filter((i) => i.productId && i.qtyM3 > 0), isUrgent: boolOf(p, "isUrgent", false), note: textOf(p, "note") || null }, user.id);
    return { key: "orders", id: r.id, message: `Sklad zayavkasi ochildi — qoralama, «Qabul qilish» bilan ishlab chiqarishga yuboring` };
  }
  if (key === "offers") {
    const validUntil = textOf(p, "validUntil");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) throw new Error("Amal qilish muddatini tanlang");
    const clientName = textOf(p, "clientName");
    if (!clientName) throw new Error("Mijoz nomini kiriting");
    const advance = textOf(p, "advance") ? numOf(p, "advance") : 0;
    if (!(advance >= 0)) throw new Error("Avans raqam bo'lsin");
    const [bk, bid] = textOf(p, "basis").split(":");
    const def = await offerDefaults();
    const units = OFFER_UNITS.map(([k]) => k);
    const items = rowsOf(p).map((r) => ({
      productId: cell(r, "productId") || null, name: cell(r, "name"),
      unit: units.includes(cell(r, "unit")) ? cell(r, "unit") : "dona", qty: cellNum(r, "qty"), price: cellNum(r, "price"),
    })).filter((l) => l.name || l.qty || l.price);
    const res = await createOffer({
      customerId: textOf(p, "customerId") || null, clientName, clientPhone: textOf(p, "clientPhone") || null, clientInn: textOf(p, "clientInn") || null,
      objectName: textOf(p, "objectName") || null, deadline: textOf(p, "deadline") || null, validUntil: new Date(`${validUntil}T00:00:00.000Z`),
      withVat: boolOf(p, "withVat", def.withVat), advance, lang: textOf(p, "lang") === "ru" ? "ru" : "uz", intro: def.intro, terms: def.terms, note: textOf(p, "note") || null,
      orderId: bk === "order" && bid ? bid : null, leadId: bk === "lead" && bid ? bid : null, items,
    }, user.id);
    if (!res.ok) throw new Error(res.error);
    return { key: "offers", id: res.id, message: `${res.offerNo} tayyor — kartochkadagi QR havolani nusxalab mijozga yuboring` };
  }
  throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
}
