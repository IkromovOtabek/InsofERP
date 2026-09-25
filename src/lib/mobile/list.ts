import { db } from "@/lib/db";
import { ecoLabel } from "@/lib/eco/labels";
import { PRODUCTION_FILTERS, assigned, dueLabel, isDone, isOpen, isSoon, partlyAssigned, prodFilter, prodSort } from "@/lib/production";
import { myBrigades } from "@/lib/brigades";
import { unitLabel } from "@/lib/unit";
import type { MobileUser } from "./auth";
import type { HomeRow, Tone } from "./home";
import type { Role } from "@/generated/prisma";

/**
 * Mobil ilovaning "ish" tabi — rolning asosiy ro'yxati.
 * Ruxsat veb ERP'dagi bilan bir xil mantiqda: rol ro'yxatda bo'lsa yoki DIRECTOR bo'lsa.
 */
/** Ro'yxat ustidagi filtr chipi — `count` ilovada chip ichida ko'rsatiladi. */
export type ListFilter = { key: string; label: string; count: number; active: boolean };
export type MobileList = { key: string; title: string; rows: HomeRow[]; filters?: ListFilter[] };

const ACCESS: Record<string, { title: string; roles: Role[] }> = {
  orders: { title: "Zayavkalar", roles: ["SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"] },
  trips: { title: "Reyslar", roles: ["LOGISTICS", "PRODUCTION", "SUPERVISOR", "DRIVER"] },
  production: { title: "Zameslar", roles: ["PRODUCTION", "SUPERVISOR"] },
  // BRIGADIER — faqat o'z brigadasiga tayinlanganlar (`myBrigadeIds`)
  tasks: { title: "Topshiriqlar", roles: ["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS", "BRIGADIER"] },
  stock: { title: "Sklad", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS"] },
  receipts: { title: "Kirimlar", roles: ["PROCUREMENT", "WAREHOUSE", "SALES"] },
  // CASHIER veb ERP'da schyotlar sahifasiga kirmaydi, lekin to'lov aynan schyot ustida olinadi —
  // mobil ilovada kassir schyotni ochib, shu yerdan to'lovni kiritadi.
  invoices: { title: "Schyotlar", roles: ["ACCOUNTING", "FINANCE", "SALES", "CASHIER"] },
  cashflow: { title: "Kirim-chiqim", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  payments: { title: "To'lovlar", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  // PRODUCTION/SUPERVISOR shu yerdan brigadir biriktiradi (veb "Brigadalar" sahifasidagidek)
  employees: { title: "Xodimlar", roles: ["HR", "LOGISTICS", "PRODUCTION", "SUPERVISOR"] },
};

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
      title: `${o.orderNo} · ${o.customer.name}${o.isUrgent ? " ⚡" : ""}`,
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
    default:
      return [];
  }
}
