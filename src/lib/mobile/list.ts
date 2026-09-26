import { db } from "@/lib/db";
import { ecoLabel } from "@/lib/eco/labels";
import { PRODUCTION_FILTERS, assigned, dueLabel, isDone, isOpen, isSoon, partlyAssigned, prodFilter, prodSort } from "@/lib/production";
import { myBrigades } from "@/lib/brigades";
import { customersCredit, customersHistory, STAR_LABELS } from "@/lib/finance";
import { driverPositionNames } from "@/lib/positions";
import { ingredientOf } from "@/lib/recipe";
import { SUPPLY_LABEL, SUPPLY_TABS, totalPlanned } from "@/lib/supply";
import { unitLabel } from "@/lib/unit";
import type { MobileUser } from "./auth";
import type { HomeRow, Tone } from "./home";
import type { LeadStatus, OrderStatus, Role, SupplyStatus } from "@/generated/prisma";

/**
 * Mobil ilovaning "ish" tabi — rolning asosiy ro'yxati.
 * Ruxsat veb ERP'dagi bilan bir xil mantiqda: rol ro'yxatda bo'lsa yoki DIRECTOR bo'lsa.
 */
/** Ro'yxat ustidagi filtr chipi — `count` ilovada chip ichida ko'rsatiladi. */
export type ListFilter = { key: string; label: string; count: number; active: boolean };
export type MobileList = { key: string; title: string; rows: HomeRow[]; filters?: ListFilter[] };

/**
 * Ro'yxat kalitlari va kim kira olishi. Rollar veb ERP menyusi (`lib/nav.ts`) bilan bir xil:
 * vebda bo'lim ko'ringan xodim ilovada ham shu bo'limni ko'radi. Farqlar izohda.
 * Tartib — bosh ekrandagi "Tezkor amallar" to'rining tartibi.
 */
const ACCESS: Record<string, { title: string; roles: Role[] }> = {
  // ── Sotuv ──
  orders: { title: "Zayavkalar", roles: ["SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"] },
  sales: { title: "Sotuv", roles: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"] },
  customers: { title: "Mijozlar", roles: ["SALES", "ACCOUNTING", "FINANCE"] },
  leads: { title: "Sayt arizalari", roles: ["SALES"] },
  // CASHIER veb ERP'da schyotlar sahifasiga kirmaydi, lekin to'lov aynan schyot ustida olinadi —
  // mobil ilovada kassir schyotni ochib, shu yerdan to'lovni kiritadi.
  invoices: { title: "Schyotlar", roles: ["ACCOUNTING", "FINANCE", "SALES", "CASHIER"] },
  // ── Ishlab chiqarish ──
  production: { title: "Zameslar", roles: ["PRODUCTION", "SUPERVISOR"] },
  recipes: { title: "Retseptlar", roles: ["PRODUCTION"] },
  // BRIGADIER — faqat o'z brigadasiga tayinlanganlar (`myBrigadeIds`)
  tasks: { title: "Topshiriqlar", roles: ["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS", "BRIGADIER"] },
  brigades: { title: "Brigadalar", roles: ["SUPERVISOR", "PRODUCTION", "HR", "SALES"] },
  // ── Logistika ──
  trips: { title: "Reyslar", roles: ["LOGISTICS", "PRODUCTION", "SUPERVISOR", "DRIVER"] },
  drivers: { title: "Haydovchilar", roles: ["LOGISTICS", "HR"] },
  // ── Sklad ──
  stock: { title: "Sklad", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS"] },
  // Snabjeniye oynasi: narx kutayotgan va qabul kutayotgan so'rovlar (vebdagi `/snabjeniye`)
  snabjeniye: { title: "Snabjeniye", roles: ["WAREHOUSE", "PROCUREMENT"] },
  // Ta'minot zayavkalari: vebda ro'yxat sklad/snabjeniye/ishlab chiqarishga, hujjatning o'zi esa
  // zanjirdagi hammaga ochiq (`/taminot/[id]`). Ilovada ro'yxat ham zanjirdagi hammaga — sotuvchi
  // tasdiq kutayotganlarni, moliya pul kutayotganlarni shu yerdan ochadi (vebdagi tasdiq kartalari o'rnida).
  supply: { title: "Ta'minot zayavkalari", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SALES", "FINANCE", "ACCOUNTING", "CASHIER"] },
  receipts: { title: "Kirimlar", roles: ["PROCUREMENT", "WAREHOUSE", "SALES"] },
  suppliers: { title: "Yetkazuvchilar", roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"] },
  // ── Moliya ──
  cashflow: { title: "Kirim-chiqim", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  payments: { title: "To'lovlar", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  // ── Boshqaruv ──
  // PRODUCTION/SUPERVISOR shu yerdan brigadir biriktiradi (veb "Brigadalar" sahifasidagidek)
  employees: { title: "Xodimlar", roles: ["HR", "LOGISTICS", "PRODUCTION", "SUPERVISOR"] },
};

/** Ro'yxat kaliti → kartochka kaliti (bir xil hujjat bir nechta ro'yxatda chiqadi). */
export const DETAIL_KEY: Record<string, string> = { sales: "orders", snabjeniye: "supply", drivers: "employees" };

/** Ta'minot ro'yxatida rol qaysi bosqichni birinchi ko'radi — vebdagi tasdiq kartalari bilan bir xil. */
const SUPPLY_DEFAULT: Partial<Record<Role, string>> = {
  SALES: "PRICED", FINANCE: "APPROVED", ACCOUNTING: "APPROVED", CASHIER: "APPROVED",
  PROCUREMENT: "NEW", WAREHOUSE: "open", PRODUCTION: "open",
};

/** Sotuv bo'limi — qabul qilingan zayavkalar (vebdagi `/sales` bilan bir xil holatlar). */
const SALES_STATUSES: OrderStatus[] = ["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"];
const ORDER_LABEL: Record<string, string> = { DRAFT: "Qoralama", BLOCKED: "Bloklangan", CONFIRMED: "Tasdiqlangan", IN_PRODUCTION: "Ishlab chiqarilmoqda", DELIVERED: "Yetkazildi", CLOSED: "Yopilgan", CANCELLED: "Bekor" };
const LEAD_LABEL: Record<LeadStatus, string> = { NEW: "Yangi", IN_PROGRESS: "Bog'lanildi", CONVERTED: "Mijoz bo'ldi", REJECTED: "Bekor" };
const LEAD_TONE: Record<LeadStatus, Tone> = { NEW: "brand", IN_PROGRESS: "warning", CONVERTED: "success", REJECTED: "danger" };
const SUPPLY_TONE: Record<SupplyStatus, Tone> = { NEW: "info", PRICED: "warning", APPROVED: "warning", FUNDED: "brand", RECEIVED: "success", REJECTED: "danger" };

/** Shu rol kira oladigan barcha ro'yxatlar — bosh ekrandagi tezkor amallar uchun. */
export function listsFor(role: Role) {
  return Object.entries(ACCESS)
    .filter(([, m]) => role === "DIRECTOR" || m.roles.includes(role))
    .map(([key, m]) => ({ key, title: m.title }));
}

export class ListError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}

const sum = (n: unknown) => Number(n ?? 0);
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const m3 = (n: number) => `${n.toFixed(n % 1 ? 1 : 0)} m³`;
const day = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
const ORDER_TONE: Record<string, Tone> = { DRAFT: "info", BLOCKED: "danger", CONFIRMED: "brand", IN_PRODUCTION: "warning", DELIVERED: "success", CLOSED: "success", CANCELLED: "danger" };
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };

const TAKE = 60;

/** Zayavkalar ro'yxati ishlab chiqarish ko'rinishida chiqadigan rollar (veb "/production" bilan bir xil). */
const PROD_VIEW: Role[] = ["PRODUCTION", "SUPERVISOR"];

export async function mobileList(user: MobileUser, key: string, q?: string, filter?: string): Promise<MobileList> {
  const meta = ACCESS[key];
  if (!meta) throw new ListError("UNKNOWN_LIST", "Bunday ro'yxat yo'q", 404);
  if (user.role !== "DIRECTOR" && !meta.roles.includes(user.role)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const s = q?.trim() || undefined;
  // Ishlab chiqarish uchun zayavkalar veb "/production" oynasidagidek: filtrlar va brigada holati bilan
  if (key === "orders" && PROD_VIEW.includes(user.role)) return productionOrders(meta.title, s, filter);
  // Filtr chipli ro'yxatlar — bosqich bo'yicha
  if (key === "supply") return supplyRequests(meta.title, s, filter ?? SUPPLY_DEFAULT[user.role] ?? "open");
  if (key === "snabjeniye") return snabjeniye(meta.title, s, filter);
  if (key === "leads") return leads(meta.title, s, filter);
  if (key === "sales") return salesOrders(meta.title, s, filter);
  // Haydovchi faqat o'ziga biriktirilgan reyslarni ko'radi
  const driverId = user.role === "DRIVER" ? await driverEmployeeId(user.id) : undefined;
  // Brigadir faqat o'z brigadasiga tayinlangan topshiriqlarni ko'radi
  const brigadeIds = user.role === "BRIGADIER" ? await myBrigadeIds(user.id) : undefined;
  const rows = await build(key, s, driverId, brigadeIds);
  const title = user.role === "DRIVER" && key === "trips" ? "Mening reyslarim"
    : user.role === "BRIGADIER" && key === "tasks" ? "Topshiriqlarim"
    : meta.title;
  return { key, title, rows };
}

/**
 * "Zayavkalar" — ishlab chiqarish ko'rinishi: filtr chiplari (Ochiq, Bugungilar, Muddati yaqin,
 * Brigada kutayotgan, Zarur, Tugallanganlar, Hammasi) va har qatorda brigada holati.
 * Sanoq qoidalari `lib/production.ts` da — veb sahifadagi raqamlar bilan bir xil chiqadi.
 */
async function productionOrders(title: string, q?: string, filter?: string): Promise<MobileList> {
  const all = await db.order.findMany({
    where: {
      status: { not: "CANCELLED" },
      ...(q ? { OR: [{ orderNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { deliveryAddress: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { deliveryDate: "asc" }, take: 400,
    include: { customer: true, items: { include: { product: true, brigade: true, task: true } } },
  });
  const f = prodFilter(filter);
  const rows = prodSort(all.filter(f.test)).slice(0, TAKE).map((o) => {
    const ok = assigned(o);
    const done = isDone(o);
    const brigades = [...new Set(o.items.map((i) => i.brigade?.name).filter(Boolean))].join(", ");
    return {
      id: o.id,
      title: `${o.orderNo} · ${o.customer.name}${o.isUrgent ? " · zarur" : ""}`,
      subtitle: `${day(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""} · ${isOpen(o) ? dueLabel(o.deliveryDate) : o.deliveryAddress}${brigades ? ` · ${brigades}` : ""}`,
      right: m3(o.items.reduce((s, i) => s + sum(i.qtyM3), 0)),
      status: done ? "Tugallandi" : ok ? "Brigada tayinlangan" : partlyAssigned(o) ? "Qisman tayinlangan" : "Brigada kutmoqda",
      tone: (done ? "success" : isSoon(o) ? "danger" : ok ? "brand" : "warning") as Tone,
    };
  });
  return {
    key: "orders", title, rows,
    filters: PRODUCTION_FILTERS.map((x) => ({ key: x.key, label: x.label, count: all.filter(x.test).length, active: x.key === f.key })),
  };
}

const supplyInclude = { items: true, warehouse: true, supplier: true, createdBy: { select: { fullName: true } } } as const;
type SupplyRow = { id: string; docNo: string; status: SupplyStatus; date: Date; needBy: Date | null; recheck: number; deliveryCost: unknown; warehouse: { name: string }; supplier: { name: string } | null; items: { qty: unknown; price: unknown; factQty?: unknown; factPrice?: unknown }[] };

/** Ta'minot zayavkasi qatori — hamma ro'yxatda bir xil ko'rinadi. */
const supplyRow = (r: SupplyRow): HomeRow => ({
  id: r.id,
  title: `${r.docNo} · ${r.warehouse.name}${r.recheck ? " · qayta tasdiq" : ""}`,
  subtitle: `${day(r.date)} · ${r.items.length} qator${r.supplier ? ` · ${r.supplier.name}` : ""}${r.needBy ? ` · kerak ${day(r.needBy)}` : ""}`,
  right: r.status === "NEW" ? `${r.items.length} nom` : money(totalPlanned({ items: r.items as { qty: number; price: number }[], deliveryCost: r.deliveryCost as number })),
  status: SUPPLY_LABEL[r.status],
  tone: SUPPLY_TONE[r.status],
});

const supplyWhere = (q?: string) => (q ? { OR: [{ docNo: { contains: q, mode: "insensitive" as const } }, { items: { some: { name: { contains: q, mode: "insensitive" as const } } } }, { supplier: { name: { contains: q, mode: "insensitive" as const } } }] } : {});

/**
 * Ta'minot zayavkalari — vebdagi `/taminot` bilan bir xil bosqich tablari.
 * Sotuvchi "Tasdiq kutmoqda", moliya "Moliya kutmoqda" bilan ochadi (`SUPPLY_DEFAULT`).
 */
async function supplyRequests(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tab = SUPPLY_TABS.find((t) => t.key === filter) ?? SUPPLY_TABS[0];
  const [rows, counts] = await Promise.all([
    db.supplyRequest.findMany({ where: { status: { in: tab.status }, ...supplyWhere(q) }, orderBy: { date: "desc" }, take: TAKE, include: supplyInclude }),
    db.supplyRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const by = (s: SupplyStatus[]) => counts.filter((c) => s.includes(c.status)).reduce((n, c) => n + c._count._all, 0);
  return {
    key: "supply", title, rows: rows.map(supplyRow),
    filters: SUPPLY_TABS.map((t) => ({ key: t.key, label: t.label, count: by(t.status), active: t.key === tab.key })),
  };
}

/** Snabjeniye: narx qo'yiladigan (NEW/PRICED) va qabul qilinadigan (FUNDED) so'rovlar — vebdagi `/snabjeniye`. */
async function snabjeniye(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tabs: { key: string; label: string; status: SupplyStatus[] }[] = [
    { key: "price", label: "Narx qo'yish", status: ["NEW", "PRICED"] },
    { key: "receive", label: "Qabul qilish", status: ["FUNDED"] },
    { key: "done", label: "Qabul qilingan", status: ["RECEIVED"] },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const [rows, counts] = await Promise.all([
    db.supplyRequest.findMany({ where: { status: { in: tab.status }, ...supplyWhere(q) }, orderBy: { date: "desc" }, take: TAKE, include: supplyInclude }),
    db.supplyRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const by = (s: SupplyStatus[]) => counts.filter((c) => s.includes(c.status)).reduce((n, c) => n + c._count._all, 0);
  return { key: "snabjeniye", title, rows: rows.map(supplyRow), filters: tabs.map((t) => ({ key: t.key, label: t.label, count: by(t.status), active: t.key === tab.key })) };
}

/** Sayt arizalari — holat bo'yicha tablar (vebdagi `/leads`). Yangi arizalar birinchi. */
async function leads(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tabs: { key: string; label: string; status?: LeadStatus }[] = [
    { key: "NEW", label: "Yangi", status: "NEW" },
    { key: "IN_PROGRESS", label: "Bog'lanildi", status: "IN_PROGRESS" },
    { key: "CONVERTED", label: "Mijoz bo'ldi", status: "CONVERTED" },
    { key: "REJECTED", label: "Bekor", status: "REJECTED" },
    { key: "all", label: "Hammasi" },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const [rows, counts] = await Promise.all([
    db.lead.findMany({
      where: { ...(tab.status ? { status: tab.status } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { address: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: { createdAt: "desc" }, take: TAKE, include: { product: { select: { name: true, unit: true } } },
    }),
    db.lead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const by = (s?: LeadStatus) => (s ? counts.find((c) => c.status === s)?._count._all ?? 0 : counts.reduce((n, c) => n + c._count._all, 0));
  return {
    key: "leads", title,
    rows: rows.map((l) => ({
      id: l.id, title: `${l.name} · ${l.phone}`,
      subtitle: `${day(l.createdAt)}${l.product ? ` · ${l.product.name}` : ""}${l.address ? ` · ${l.address}` : ""}`,
      right: l.qty && l.product ? `${sum(l.qty)} ${unitLabel(l.product.unit)}` : undefined,
      status: LEAD_LABEL[l.status], tone: LEAD_TONE[l.status],
    })),
    filters: tabs.map((t) => ({ key: t.key, label: t.label, count: by(t.status), active: t.key === tab.key })),
  };
}

/** Sotuv — qabul qilingan zayavkalar, holat tablari bilan (vebdagi `/sales`). Kartochka — zayavka. */
async function salesOrders(title: string, q?: string, filter?: string): Promise<MobileList> {
  const st = SALES_STATUSES.find((s) => s === filter);
  const [rows, counts] = await Promise.all([
    db.order.findMany({
      where: { kind: "SALE", status: st ?? { in: SALES_STATUSES }, ...(q ? { OR: [{ orderNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
      orderBy: { updatedAt: "desc" }, take: TAKE,
      include: { customer: true, items: { include: { product: true } }, invoices: { where: { status: { not: "CANCELLED" } }, include: { payments: true } } },
    }),
    db.order.groupBy({ by: ["status"], where: { kind: "SALE", status: { in: SALES_STATUSES } }, _count: { _all: true } }),
  ]);
  const by = (s?: OrderStatus) => (s ? counts.find((c) => c.status === s)?._count._all ?? 0 : counts.reduce((n, c) => n + c._count._all, 0));
  return {
    key: "sales", title,
    rows: rows.map((o) => {
      const total = o.items.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0);
      const paid = o.invoices.reduce((s, i) => s + i.payments.reduce((p, x) => p + sum(x.amount), 0), 0);
      return {
        id: o.id, title: `${o.orderNo} · ${o.customer.name}`,
        subtitle: `${day(o.deliveryDate)} · ${o.items.map((i) => i.product.code).join(", ")}${o.invoices.length ? ` · to'langan ${money(paid)}` : " · schyot yo'q"}`,
        right: money(total), status: ORDER_LABEL[o.status] ?? o.status, tone: ORDER_TONE[o.status],
      };
    }),
    filters: [{ key: "all", label: "Hammasi", count: by(), active: !st }, ...SALES_STATUSES.map((s) => ({ key: s, label: ORDER_LABEL[s], count: by(s), active: s === st }))],
  };
}

/** Login qilgan haydovchining xodim kartasi — reyslar shu id bo'yicha filtrlanadi. */
export async function driverEmployeeId(userId: string): Promise<string> {
  const e = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  if (!e) throw new ListError("NO_EMPLOYEE", "Bu login xodim kartasiga bog'lanmagan — Otdel kadrga ayting", 403);
  return e.id;
}

/**
 * Login qilgan brigadirning brigadalari. Brigadir bo'lmasa ro'yxat ochilmaydi —
 * "hammaning topshirig'i" ko'rinib qolgandan ko'ra tushunarli xato yaxshiroq.
 */
export async function myBrigadeIds(userId: string): Promise<string[]> {
  const list = await myBrigades(userId);
  if (list.length === 0) throw new ListError("NO_BRIGADE", "Siz hali brigadaga brigadir qilib biriktirilmagansiz — ishlab chiqarishga ayting", 403);
  return list.map((b) => b.id);
}

async function build(key: string, q?: string, driverId?: string, brigadeIds?: string[]): Promise<HomeRow[]> {
  switch (key) {
    case "orders": {
      const list = await db.order.findMany({
        where: q ? { OR: [{ orderNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { customer: true, items: true },
      });
      return list.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer.name}`, subtitle: `${day(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""} · ${o.deliveryAddress}`, right: m3(o.items.reduce((s, i) => s + sum(i.qtyM3), 0)), status: o.status, tone: ORDER_TONE[o.status] }));
    }
    case "trips": {
      const list = await db.trip.findMany({
        where: {
          ...(driverId ? { driverId } : {}),
          ...(q ? { OR: [{ deliveryNoteNo: { contains: q, mode: "insensitive" } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : {}),
        },
        orderBy: { createdAt: "desc" }, take: TAKE, include: { order: { include: { customer: true } }, driver: true, vehicle: true },
      });
      return list.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.driver.fullName} · ${t.vehicle.plate}${t.ecoStatus ? ` · ${ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus}` : ""}`, right: m3(sum(t.qtyM3)), status: t.status, tone: t.ecoError ? "danger" : TRIP_TONE[t.status] }));
    }
    case "tasks": {
      const list = await db.brigadeTask.findMany({
        where: {
          ...(brigadeIds ? { brigadeId: { in: brigadeIds } } : {}),
          ...(q ? { OR: [{ taskNo: { contains: q, mode: "insensitive" } }, { brigade: { name: { contains: q, mode: "insensitive" } } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : {}),
        },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: TAKE,
        include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } },
      });
      const now = new Date(); now.setHours(0, 0, 0, 0);
      return list.map((t) => {
        const unit = unitLabel(t.orderItem.product.unit);
        return {
        id: t.id,
        // Brigadirga o'z brigadasining nomi har qatorda takrorlanmaydi — mahsulot muhimroq
        title: brigadeIds ? `${t.taskNo} · ${t.orderItem.product.name}` : `${t.taskNo} · ${t.brigade.name}`,
        subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`,
        right: `${(sum(t.qty) - sum(t.doneQty)).toFixed(1)} / ${sum(t.qty)} ${unit}`,
        status: t.status,
        tone: t.status === "DONE" ? ("success" as Tone) : t.status === "CANCELLED" ? ("info" as Tone) : t.dueDate < now ? ("danger" as Tone) : ("warning" as Tone),
        };
      });
    }
    case "production": {
      const list = await db.productionBatch.findMany({
        where: q ? { OR: [{ batchNo: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { product: true, order: { include: { customer: true } } },
      });
      return list.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: `${day(b.date)} · ${b.order ? b.order.customer.name : "Omborga"}`, right: m3(sum(b.qtyM3)), status: `${b.shift}-smena` }));
    }
    case "stock": {
      const [materials, balances] = await Promise.all([
        db.material.findMany({ where: { isActive: true, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" } }),
        db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
      ]);
      const bal = new Map(balances.map((b) => [b.materialId, sum(b._sum.qty)]));
      return materials.map((m) => {
        const b = bal.get(m.id) ?? 0;
        const low = b < sum(m.minStock);
        return { id: m.id, title: m.name, subtitle: `${m.code} · minimum ${sum(m.minStock)} ${m.unit}`, right: `${b.toFixed(1)} ${m.unit}`, status: low ? "Kam" : undefined, tone: low ? "danger" : "success" };
      });
    }
    case "receipts": {
      const list = await db.goodsReceipt.findMany({
        where: q ? { OR: [{ docNo: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }] } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { supplier: true, items: true },
      });
      return list.map((r) => ({ id: r.id, title: `${r.docNo} · ${r.supplier.name}`, subtitle: `${day(r.date)} · ${r.items.length} qator`, right: money(r.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0)) }));
    }
    case "invoices": {
      const list = await db.invoice.findMany({
        where: q ? { OR: [{ invoiceNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { customer: true, payments: true },
      });
      return list.map((i) => {
        const left = sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0);
        return { id: i.id, title: `${i.invoiceNo} · ${i.customer.name}`, subtitle: `${day(i.date)} · jami ${money(sum(i.amount))}`, right: money(left), status: i.status, tone: i.status === "PAID" ? "success" : i.status === "PARTIAL" ? "warning" : i.status === "CANCELLED" ? "info" : "danger" };
      });
    }
    case "cashflow": {
      const list = await db.cashTransaction.findMany({
        where: q ? { OR: [{ category: { contains: q, mode: "insensitive" } }, { counterparty: { contains: q, mode: "insensitive" } }] } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { cashAccount: true },
      });
      return list.map((t) => ({ id: t.id, title: `${t.category}${t.counterparty ? ` · ${t.counterparty}` : ""}`, subtitle: `${day(t.date)} · ${t.cashAccount.name}`, right: `${t.type === "EXPENSE" ? "−" : "+"}${money(sum(t.amount))}`, tone: t.type === "EXPENSE" ? "danger" : "success" }));
    }
    case "payments": {
      const list = await db.payment.findMany({
        where: q ? { customer: { name: { contains: q, mode: "insensitive" } } } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { customer: true, cashAccount: true, invoice: true },
      });
      return list.map((p) => ({ id: p.id, title: p.customer.name, subtitle: `${day(p.date)} · ${p.cashAccount.name}${p.invoice ? ` · ${p.invoice.invoiceNo}` : ""}`, right: money(sum(p.amount)), tone: "success" }));
    }
    case "employees": {
      const list = await db.employee.findMany({
        where: q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { position: { contains: q, mode: "insensitive" } }, { brigades: { some: { name: { contains: q, mode: "insensitive" } } } }] } : undefined,
        orderBy: [{ isActive: "desc" }, { fullName: "asc" }], take: TAKE,
        include: { brigades: { where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } } },
      });
      return list.map((e) => {
        const led = e.brigades.map((b) => b.name).join(", ");
        return {
          id: e.id,
          title: e.fullName,
          subtitle: `${e.position}${led ? ` · ${led} brigadiri` : ""}${e.phone ? ` · ${e.phone}` : ""}`,
          right: led ? "Brigadir" : undefined,
          status: e.isActive ? "Faol" : "Nofaol",
          tone: e.isActive ? "success" : "danger",
        };
      });
    }
    // Haydovchilar — haydovchi lavozimidagi xodimlar, texnikasi va ilova holati bilan (vebdagi `/drivers`)
    case "drivers": {
      const list = await db.employee.findMany({
        where: { position: { in: await driverPositionNames() }, ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { vehicle: { plate: { contains: q, mode: "insensitive" } } }] } : {}) },
        orderBy: [{ isActive: "desc" }, { fullName: "asc" }], take: TAKE,
        include: { vehicle: { select: { plate: true } }, _count: { select: { trips: { where: { status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } } } } } },
      });
      return list.map((e) => ({
        id: e.id, title: e.fullName,
        subtitle: `${e.vehicle ? e.vehicle.plate : "texnika biriktirilmagan"}${e.phone ? ` · ${e.phone}` : " · telefonsiz"}`,
        right: e._count.trips ? `${e._count.trips} ochiq reys` : undefined,
        status: !e.isActive ? "Nofaol" : e.ecoUserId ? (e.ecoActive ? "Ilova ulangan" : "Ilova nofaol") : "Ilova ulanmagan",
        tone: !e.isActive ? "danger" : e.ecoUserId && e.ecoActive ? "success" : e.ecoError ? "danger" : "warning",
      }));
    }
    // Mijozlar — limit, qarz va yulduzcha (vebdagi `/customers` bilan bir xil hisob)
    case "customers": {
      const list = await db.customer.findMany({
        where: { isInternal: false, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { inn: { contains: q } }] } : {}) },
        orderBy: [{ isActive: "desc" }, { name: "asc" }], take: TAKE,
      });
      const ids = list.map((c) => c.id);
      const credit = await customersCredit(ids);
      const history = await customersHistory(ids, credit);
      return list.map((c) => {
        const cr = credit.get(c.id);
        const h = history.get(c.id);
        const black = !!cr?.blacklisted;
        return {
          id: c.id, title: c.name,
          subtitle: `${c.phone ?? "telefonsiz"}${h ? ` · ${STAR_LABELS[h.stars]}` : ""}${cr?.debt ? ` · qarz ${money(cr.debt)}` : ""}`,
          right: cr ? money(Math.max(0, cr.limit - cr.used)) : undefined,
          status: !c.isActive ? "Nofaol" : black ? "Qora ro'yxat" : undefined,
          tone: !c.isActive ? "info" : black ? "danger" : cr && cr.debt > 0 ? "warning" : "success",
        };
      });
    }
    // Brigadalar — brigadiri va ochiq topshiriqlari (vebdagi `/brigades`)
    case "brigades": {
      const list = await db.brigade.findMany({
        where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { leader: { fullName: { contains: q, mode: "insensitive" } } }] } : undefined,
        orderBy: [{ isActive: "desc" }, { name: "asc" }], take: TAKE,
        include: { leader: { select: { fullName: true, phone: true } }, _count: { select: { tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } } } } } },
      });
      return list.map((b) => ({
        id: b.id, title: b.name,
        subtitle: b.leader ? `Brigadir: ${b.leader.fullName}${b.leader.phone ? ` · ${b.leader.phone}` : ""}` : "Brigadir biriktirilmagan",
        right: `${b._count.tasks} topshiriq`,
        status: b.isActive ? undefined : "Nofaol",
        tone: !b.isActive ? "info" : b.leader ? "success" : "warning",
      }));
    }
    // Yetkazuvchilar — oxirgi kirimi bilan (vebdagi `/suppliers`)
    case "suppliers": {
      const list = await db.supplier.findMany({
        where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { inn: { contains: q } }] } : undefined,
        orderBy: [{ isActive: "desc" }, { name: "asc" }], take: TAKE,
        include: { _count: { select: { receipts: true } }, receipts: { orderBy: { date: "desc" }, take: 1, select: { date: true } } },
      });
      return list.map((s) => ({
        id: s.id, title: s.name,
        subtitle: `${s.phone ?? "telefonsiz"}${s.inn ? ` · INN ${s.inn}` : ""}${s.receipts[0] ? ` · oxirgi kirim ${day(s.receipts[0].date)}` : ""}`,
        right: `${s._count.receipts} kirim`,
        status: s.isActive ? undefined : "Nofaol",
        tone: s.isActive ? "success" : "info",
      }));
    }
    // Retseptlar — har mahsulotning amaldagi retsepti (vebdagi `/recipes`); id — mahsulot id'si
    case "recipes": {
      const list = await db.product.findMany({
        where: { isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}) },
        orderBy: { code: "asc" }, take: TAKE,
        include: { recipes: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1, include: { items: { include: { material: true, product: true } } } } },
      });
      return list.map((p) => {
        const r = p.recipes[0];
        return {
          id: p.id, title: `${p.code} · ${p.name}`,
          subtitle: r ? r.items.map((i) => { const ing = ingredientOf(i); return `${ing.name} ${ing.qtyPerM3} ${ing.unit}`; }).join(" · ") : "Retsept tuzilmagan",
          right: r ? `v${r.version}` : undefined,
          status: r ? `${r.items.length} tarkib` : "Yo'q",
          tone: r ? "success" : "warning",
        };
      });
    }
    default:
      return [];
  }
}
