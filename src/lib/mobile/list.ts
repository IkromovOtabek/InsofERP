import { db } from "@/lib/db";
import { ecoLabel } from "@/lib/eco/labels";
import type { MobileUser } from "./auth";
import type { HomeRow, Tone } from "./home";
import type { Role } from "@/generated/prisma";

/**
 * Mobil ilovaning "ish" tabi — rolning asosiy ro'yxati.
 * Ruxsat veb ERP'dagi bilan bir xil mantiqda: rol ro'yxatda bo'lsa yoki DIRECTOR bo'lsa.
 */
export type MobileList = { key: string; title: string; rows: HomeRow[] };

const ACCESS: Record<string, { title: string; roles: Role[] }> = {
  orders: { title: "Zayavkalar", roles: ["SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"] },
  trips: { title: "Reyslar", roles: ["LOGISTICS", "PRODUCTION", "SUPERVISOR"] },
  production: { title: "Zameslar", roles: ["PRODUCTION", "SUPERVISOR"] },
  tasks: { title: "Topshiriqlar", roles: ["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS"] },
  stock: { title: "Sklad", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS"] },
  receipts: { title: "Kirimlar", roles: ["PROCUREMENT", "WAREHOUSE", "SALES"] },
  // CASHIER veb ERP'da schyotlar sahifasiga kirmaydi, lekin to'lov aynan schyot ustida olinadi —
  // mobil ilovada kassir schyotni ochib, shu yerdan to'lovni kiritadi.
  invoices: { title: "Schyotlar", roles: ["ACCOUNTING", "FINANCE", "SALES", "CASHIER"] },
  cashflow: { title: "Kirim-chiqim", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  payments: { title: "To'lovlar", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  employees: { title: "Xodimlar", roles: ["HR", "LOGISTICS"] },
};

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

export async function mobileList(user: MobileUser, key: string, q?: string): Promise<MobileList> {
  const meta = ACCESS[key];
  if (!meta) throw new ListError("UNKNOWN_LIST", "Bunday ro'yxat yo'q", 404);
  if (user.role !== "DIRECTOR" && !meta.roles.includes(user.role)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const s = q?.trim() || undefined;
  const rows = await build(key, s);
  return { key, title: meta.title, rows };
}

async function build(key: string, q?: string): Promise<HomeRow[]> {
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
        where: q ? { OR: [{ deliveryNoteNo: { contains: q, mode: "insensitive" } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : undefined,
        orderBy: { createdAt: "desc" }, take: TAKE, include: { order: { include: { customer: true } }, driver: true, vehicle: true },
      });
      return list.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.driver.fullName} · ${t.vehicle.plate}${t.ecoStatus ? ` · ${ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus}` : ""}`, right: m3(sum(t.qtyM3)), status: t.status, tone: t.ecoError ? "danger" : TRIP_TONE[t.status] }));
    }
    case "tasks": {
      const list = await db.brigadeTask.findMany({
        where: q ? { OR: [{ taskNo: { contains: q, mode: "insensitive" } }, { brigade: { name: { contains: q, mode: "insensitive" } } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : undefined,
        orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: TAKE, include: { brigade: true, order: { include: { customer: true } } },
      });
      const now = new Date(); now.setHours(0, 0, 0, 0);
      return list.map((t) => ({
        id: t.id,
        title: `${t.taskNo} · ${t.brigade.name}`,
        subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`,
        right: `${(sum(t.qty) - sum(t.doneQty)).toFixed(1)} / ${sum(t.qty)} m³`,
        status: t.status,
        tone: t.status === "DONE" ? ("success" as Tone) : t.status === "CANCELLED" ? ("info" as Tone) : t.dueDate < now ? ("danger" as Tone) : ("warning" as Tone),
      }));
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
        where: q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { position: { contains: q, mode: "insensitive" } }] } : undefined,
        orderBy: [{ isActive: "desc" }, { fullName: "asc" }], take: TAKE,
      });
      return list.map((e) => ({ id: e.id, title: e.fullName, subtitle: `${e.position}${e.phone ? ` · ${e.phone}` : ""}`, status: e.isActive ? "Faol" : "Nofaol", tone: e.isActive ? "success" : "danger" }));
    }
    default:
      return [];
  }
}
