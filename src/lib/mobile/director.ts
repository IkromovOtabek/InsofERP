import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/nav";
import type { Prisma } from "@/generated/prisma";
import type { HomeRow, HomeSection, Tone } from "./home";
import { ListError, type ListFilter, type MobileList } from "./list";
import type { MobileDetail } from "./detail";

/**
 * Direktor ilovasi uchun maxsus ro'yxatlar:
 *   · "Tasdiqlar" (pastki paneldagi ikkinchi tab) — direktor qarorini kutayotgan hujjatlar;
 *   · "Xodimlar faoliyati" — bugun kim nima qildi (bosh sahifadagi "Bugungi holat" bosilganda).
 *
 * Tasdiqlar ro'yxatida turli hujjatlar aralash turadi, shuning uchun qator id'si
 * `<kartochka kaliti>:<id>` ko'rinishida (`orders:ck…`) — `mobileDetail` va `runMobileAction`
 * uni ajratib, oddiy kartochkani ochadi.
 */

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const dayLabel = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Aralash ro'yxat id'si → [kartochka kaliti, haqiqiy id]. */
export function splitRef(id: string): [string | null, string] {
  const i = id.indexOf(":");
  return i > 0 ? [id.slice(0, i), id.slice(i + 1)] : [null, id];
}

// ───────────────────────── Tasdiqlar ─────────────────────────

export async function approvalsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const like = (s: string): Prisma.StringFilter => ({ contains: s, mode: "insensitive" });
  const [blocked, supply] = await Promise.all([
    db.order.findMany({
      where: { status: "BLOCKED", ...(q ? { OR: [{ orderNo: like(q) }, { customer: { name: like(q) } }] } : {}) },
      orderBy: { date: "desc" }, take: 50,
      include: { customer: { select: { name: true } }, items: { select: { qtyM3: true, price: true } } },
    }),
    // Narx qo'yilgan (tasdiq kutmoqda) va tasdiqlangan, lekin hali to'lanmagan ta'minot
    db.supplyRequest.findMany({
      where: { status: { in: ["PRICED", "APPROVED"] }, ...(q ? { OR: [{ docNo: like(q) }, { supplier: { name: like(q) } }] } : {}) },
      orderBy: { createdAt: "desc" }, take: 50,
      include: { supplier: { select: { name: true } }, items: { select: { qty: true, price: true } }, createdBy: { select: { fullName: true } } },
    }),
  ]);

  const orderRows: HomeRow[] = blocked.map((o) => ({
    id: `orders:${o.id}`, title: `${o.orderNo} · ${o.customer.name}`,
    subtitle: `Kredit limiti oshgan · ${dayLabel(o.date)}`,
    right: money(o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0)),
    status: "Bloklangan", tone: "danger",
  }));
  const supplyRows: HomeRow[] = supply.map((r) => ({
    id: `supply:${r.id}`, title: `${r.docNo}${r.supplier ? ` · ${r.supplier.name}` : ""}`,
    subtitle: `${r.status === "PRICED" ? "Narx qo'yildi — tasdiq kutmoqda" : "Tasdiqlangan — to'lov kutmoqda"} · ${r.createdBy.fullName}`,
    right: money(r.items.reduce((s, i) => s + Number(i.qty) * Number(i.price ?? 0), 0)),
    status: r.status === "PRICED" ? "Tasdiq" : "To'lov", tone: r.status === "PRICED" ? "warning" : "info",
  }));

  const tabs = [
    { key: "all", label: "Hammasi", rows: [...orderRows, ...supplyRows] },
    { key: "orders", label: "Bloklangan zayavka", rows: orderRows },
    { key: "supply", label: "Ta'minot", rows: supplyRows },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const rows = [...tab.rows];
  const filters: ListFilter[] = tabs.map((t) => ({ key: t.key, label: t.label, count: t.rows.length, active: t.key === tab.key }));
  return { key: "approvals", title, rows, filters };
}

// ───────────────────────── Xodimlar faoliyati ─────────────────────────

const ENTITY: Record<string, string> = {
  Order: "zayavka", Trip: "reys", Payment: "to'lov", Invoice: "schyot", SupplyRequest: "ta'minot zayavkasi", GoodsReceipt: "kirim",
  ProductionBatch: "zames", BrigadeTask: "brigada topshirig'i", BrigadeMove: "brigada harakati", Customer: "mijoz", Lead: "ariza",
  CashTransaction: "kirim-chiqim", Employee: "xodim kartasi", Vehicle: "texnika", Material: "xomashyo", Recipe: "retsept",
  StockMove: "sklad harakati", TripIssue: "reys muammosi", FuelLog: "zapravka", TransportExpense: "transport xarajati",
  Site: "obyekt", ShopItem: "vitrina", ShopBanner: "reklama", Attendance: "davomat", ExpenseBudget: "byudjet", SalesPlan: "sotuv plani",
  Product: "mahsulot", User: "foydalanuvchi", CompanySettings: "sozlamalar", ProductDefect: "brak", ProductionPlan: "ishlab chiqarish plani",
};
const STATUS_WORD: Record<string, string> = {
  CONFIRMED: "tasdiqlandi", BLOCKED: "bloklandi", CANCELLED: "bekor qilindi", DELIVERED: "yetkazildi", IN_PRODUCTION: "ishlab chiqarishda",
  LOADED: "yuklandi", ON_ROAD: "yo'lga chiqdi", PRICED: "narx qo'yildi", APPROVED: "tasdiqlandi", FUNDED: "pul ajratildi", RECEIVED: "qabul qilindi",
  NEW: "yangi holatga qaytarildi", PLANNED: "rejalashtirildi", IN_PROGRESS: "ishga olindi", CONVERTED: "mijozga aylantirildi", REJECTED: "rad etildi", DONE: "bajarildi",
};

type AuditRow = { action: string; entity: string; after: Prisma.JsonValue; before: Prisma.JsonValue; createdAt: Date };

/** Audit yozuvi → odam o'qiydigan bir qator: "Zayavka Z-2026-00031 ochdi", "Reys N-… yetkazildi". */
function describe(a: AuditRow): string {
  const x = (a.after ?? {}) as Record<string, unknown>;
  const ref = String(x.orderNo ?? x.deliveryNoteNo ?? x.docNo ?? x.invoiceNo ?? x.batchNo ?? x.taskNo ?? x.name ?? x.fullName ?? x.plate ?? x.title ?? x.product ?? "");
  const what = ENTITY[a.entity] ?? a.entity;
  const amount = typeof x.amount === "number" || typeof x.amount === "string" ? ` · ${money(Number(x.amount))}` : "";
  const refTxt = ref ? ` ${ref}` : "";
  if (a.action === "CREATE") return `Yangi ${what}${refTxt}${amount}`;
  if (a.action === "DELETE") return `O'chirildi: ${what}${refTxt}`;
  if (a.action === "STATUS_CHANGE") {
    const st = String(x.status ?? x.phase ?? "");
    return `${what[0].toUpperCase()}${what.slice(1)}${refTxt} — ${STATUS_WORD[st] ?? (st.toLowerCase() || "holat o'zgardi")}`;
  }
  return `Tahrir: ${what}${refTxt}`;
}

function todayRange() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  return { from, to };
}

/** Bugun kim nima qildi — xodim bo'yicha jamlanma; qator bosilsa o'sha xodimning amallari. */
export async function activityList(title: string, q?: string): Promise<MobileList> {
  const { from, to } = todayRange();
  const log = await db.auditLog.findMany({
    where: { createdAt: { gte: from, lt: to }, ...(q ? { user: { fullName: { contains: q, mode: "insensitive" } } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { userId: true, entity: true, action: true, createdAt: true, user: { select: { fullName: true, role: true } } },
  });
  const byUser = new Map<string, { name: string; role: string; n: number; last: Date; kinds: Map<string, number> }>();
  for (const l of log) {
    const u = byUser.get(l.userId) ?? { name: l.user.fullName, role: l.user.role, n: 0, last: l.createdAt, kinds: new Map() };
    u.n++;
    const k = ENTITY[l.entity] ?? l.entity;
    u.kinds.set(k, (u.kinds.get(k) ?? 0) + 1);
    byUser.set(l.userId, u);
  }
  const rows: HomeRow[] = [...byUser.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, u]) => ({
    id, title: u.name,
    subtitle: `${ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role} · ${[...u.kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(", ")}`,
    right: `${u.n} amal`, status: `oxirgi ${hm(u.last)}`, tone: "brand" as Tone,
  }));
  return { key: "activity", title, rows };
}

/** Bitta xodimning bugungi amallari (vaqt bo'yicha). */
export async function activityDetail(userId: string): Promise<MobileDetail> {
  const { from, to } = todayRange();
  const [user, log] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { fullName: true, role: true, login: true } }),
    db.auditLog.findMany({ where: { userId, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, action: true, entity: true, after: true, before: true, createdAt: true } }),
  ]);
  if (!user) throw new ListError("NOT_FOUND", "Xodim topilmadi", 404);
  const section: HomeSection = {
    title: "Bugungi amallar", empty: "Bugun amal yo'q", icon: "clock",
    rows: log.map((l) => ({ id: l.id, title: describe(l), right: hm(l.createdAt), tone: (l.action === "DELETE" ? "danger" : l.action === "CREATE" ? "success" : "info") as Tone })),
  };
  return {
    key: "activity", id: userId, title: user.fullName, subtitle: ROLE_LABELS[user.role] ?? user.role,
    fields: [
      { label: "Login", value: user.login },
      { label: "Bugun", value: `${log.length} amal` },
      ...(log[0] ? [{ label: "Oxirgi amal", value: hm(log[0].createdAt) }] : []),
      ...(log.length ? [{ label: "Birinchi amal", value: hm(log[log.length - 1].createdAt) }] : []),
    ],
    sections: [section],
    actions: [],
  };
}
