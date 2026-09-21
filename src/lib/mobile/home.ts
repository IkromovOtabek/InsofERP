import { db } from "@/lib/db";
import { driverPositionNames } from "@/lib/positions";
import { ROLE_LABELS } from "@/lib/nav";
import { ecoLabel } from "@/lib/eco/labels";
import { CREATE_ROLES, canCreate } from "./create";
import { listsFor } from "./list";
import { prodFilter } from "@/lib/production";
import type { MobileUser } from "./auth";
import type { Role } from "@/generated/prisma";

/**
 * Mobil ilova bosh ekrani — rolga qarab. Server nimani ko'rsatishni hal qiladi,
 * ilova faqat chizadi: shunda yangi ko'rsatkich qo'shish uchun ilovani qayta chiqarish shart emas.
 */
export type Tone = "brand" | "success" | "warning" | "danger" | "info";
/** `icon` — Ionicons nomi; ilova kartaning yuqorisida chizadi. */
export type HomeCard = { key: string; label: string; value: string; hint?: string; tone?: Tone; icon?: string };
export type HomeRow = { id: string; title: string; subtitle?: string; right?: string; status?: string; tone?: Tone };
/** `target` — qator bosilganda ochiladigan kartochka turi (`/api/mobile/detail?key=...`). Bo'lmasa qator bosilmaydi. */
/** `kind: "list"` — ro'yxatni ochadi, `kind: "new"` — yangi hujjat formasini. */
export type QuickAction = { key: string; label: string; icon: string; kind: "list" | "new" };
export type HomeSection = { title: string; empty: string; rows: HomeRow[]; target?: string };
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
};

/** Har bir rolning "ishchi" ro'yxati — `lib/mobile/list.ts` dagi kalit. */
export const ROLE_LIST: Record<Role, { key: string; title: string }> = {
  DIRECTOR: { key: "orders", title: "Zayavkalar" },
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
};

/** Tezkor amal katakchasi ikonlari. */
const LIST_ICON: Record<string, string> = {
  orders: "document-text", trips: "bus", tasks: "checkbox", production: "cube", stock: "layers",
  receipts: "download", invoices: "receipt", cashflow: "swap-vertical", payments: "cash", employees: "people",
};

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const startOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; };
const sum = (n: unknown) => Number(n ?? 0);
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const short = (n: number) =>
  n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(1)} mlrd` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)} mln` : n >= 1_000 ? `${Math.round(n / 1_000)} ming` : String(Math.round(n));
const m3 = (n: number) => `${n.toFixed(n % 1 ? 1 : 0)} m³`;
const time = (d: Date) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const day = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

const ORDER_TONE: Record<string, Tone> = { DRAFT: "info", BLOCKED: "danger", CONFIRMED: "brand", IN_PRODUCTION: "warning", DELIVERED: "success", CLOSED: "success", CANCELLED: "danger" };
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };

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

export async function mobileHome(user: MobileUser): Promise<MobileHome> {
  const list = ROLE_LIST[user.role];
  const creatable = Object.keys(CREATE_ROLES).find((k) => canCreate(user, k) && (k === list.key || user.role === "DIRECTOR"));
  const quick: QuickAction[] = [
    ...(creatable ? [{ key: creatable, label: CREATE_ROLES[creatable].label, icon: "add", kind: "new" as const }] : []),
    ...listsFor(user.role).filter((l) => l.key !== list.key).map((l) => ({ key: l.key, label: l.title, icon: LIST_ICON[l.key] ?? "folder", kind: "list" as const })),
  ].slice(0, 6);
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
      const [todayOrders, blocked, onRoad, monthItems, recent, trips] = await Promise.all([
        db.order.count({ where: { date: { gte: today }, status: { not: "CANCELLED" } } }),
        db.order.count({ where: { status: "BLOCKED" } }),
        db.trip.count({ where: { status: { in: ["LOADED", "ON_ROAD"] } } }),
        db.orderItem.findMany({ where: { order: { date: { gte: startOfMonth() }, status: { not: "CANCELLED" } } }, select: { qtyM3: true, price: true } }),
        db.order.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { date: "desc" }, take: 8, include: { customer: true, items: true } }),
        db.trip.findMany({ where: { status: { in: ["LOADED", "ON_ROAD"] } }, orderBy: { createdAt: "desc" }, take: 8, include: { order: { include: { customer: true } }, driver: true, vehicle: true } }),
      ]);
      const revenue = monthItems.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0);
      cards.push(
        { key: "revenue", label: "Oylik tushum", value: short(revenue), hint: "so'm", tone: "success", icon: "trending-up" },
        { key: "today", label: "Bugungi zayavka", value: String(todayOrders), tone: "brand", icon: "today" },
        { key: "onroad", label: "Yo'ldagi reys", value: String(onRoad), tone: "info", icon: "navigate" },
        { key: "blocked", label: "Bloklangan", value: String(blocked), hint: blocked ? "ochish kerak" : undefined, tone: blocked ? "danger" : "success", icon: "lock-closed" },
      );
      sections.push(
        { title: "So'nggi zayavkalar", empty: "Zayavka yo'q", target: "orders", rows: recent.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer.name}`, subtitle: `${day(o.deliveryDate)} · ${o.deliveryAddress}`, right: m3(o.items.reduce((s, i) => s + sum(i.qtyM3), 0)), status: o.status, tone: ORDER_TONE[o.status] })) },
        { title: "Yo'ldagi reyslar", empty: "Yo'lda reys yo'q", target: "trips", rows: trips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.driver.fullName} · ${t.vehicle.plate}`, right: m3(sum(t.qtyM3)), status: t.status, tone: TRIP_TONE[t.status] })) },
      );
      break;
    }

    case "SALES": {
      const [mine, blocked, monthItems, recent] = await Promise.all([
        db.order.count({ where: { createdById: user.id, date: { gte: today }, status: { not: "CANCELLED" } } }),
        db.order.count({ where: { status: "BLOCKED" } }),
        db.orderItem.findMany({ where: { order: { createdById: user.id, date: { gte: startOfMonth() }, status: { not: "CANCELLED" } } }, select: { qtyM3: true, price: true } }),
        db.order.findMany({ where: { createdById: user.id }, orderBy: { date: "desc" }, take: 10, include: { customer: true, items: true } }),
      ]);
      cards.push(
        { key: "mine", label: "Bugungi zayavkam", value: String(mine), tone: "brand", icon: "document-text" },
        { key: "m3", label: "Oylik hajm", value: m3(monthItems.reduce((s, i) => s + sum(i.qtyM3), 0)), tone: "info", icon: "cube" },
        { key: "sum", label: "Oylik summa", value: short(monthItems.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0)), hint: "so'm", tone: "success", icon: "cash" },
        { key: "blocked", label: "Bloklangan", value: String(blocked), tone: blocked ? "danger" : "success", icon: "lock-closed" },
      );
      sections.push({ title: "Mening zayavkalarim", empty: "Hali zayavka kiritmagansiz", target: "orders", rows: recent.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer.name}`, subtitle: `${day(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""} · ${o.deliveryAddress}`, right: m3(o.items.reduce((s, i) => s + sum(i.qtyM3), 0)), status: o.status, tone: ORDER_TONE[o.status] })) });
      break;
    }

    case "PRODUCTION": {
      const [batches, inProd, tasks, openTasks, prodOrders] = await Promise.all([
        db.productionBatch.findMany({ where: { date: { gte: today } }, orderBy: { date: "desc" }, take: 10, include: { product: true, order: { include: { customer: true } } } }),
        db.order.count({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } } }),
        db.brigadeTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } }),
        db.brigadeTask.findMany({ where: { status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, take: 10, include: { brigade: true, order: { include: { customer: true } } } }),
        // "Zayavkalar" ro'yxatidagi filtrlar bilan bir xil sanoq — `lib/production.ts`
        db.order.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { deliveryDate: "asc" }, take: 400, select: { status: true, deliveryDate: true, isUrgent: true, items: { select: { task: { select: { status: true } } } } } }),
      ]);
      const count = (key: string) => prodOrders.filter(prodFilter(key).test).length;
      const waiting = count("unassigned");
      const soon = count("soon");
      cards.push(
        { key: "today", label: "Bugungi zames", value: m3(batches.reduce((s, b) => s + sum(b.qtyM3), 0)), hint: `${batches.length} partiya`, tone: "brand", icon: "today" },
        { key: "unassigned", label: "Brigada kutayotgan", value: String(waiting), hint: "zayavka", tone: waiting ? "warning" : "success", icon: "hammer" },
        { key: "soon", label: "Muddati yaqin", value: String(soon), hint: "≤ 2 kun", tone: soon ? "danger" : "success", icon: "alarm" },
        { key: "inprod", label: "Ishlab chiqarishda", value: String(inProd), hint: "zayavka", tone: "warning", icon: "construct" },
        { key: "tasks", label: "Ochiq topshiriq", value: String(tasks), tone: tasks ? "info" : "success", icon: "list" },
      );
      sections.push(
        { title: "Ochiq topshiriqlar", empty: "Topshiriq yo'q", rows: openTasks.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.brigade.name}`, subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`, right: m3(sum(t.qty) - sum(t.doneQty)), status: t.status, tone: t.status === "NEW" ? "info" : "warning" })) },
        { title: "Bugungi zameslar", empty: "Bugun zames yo'q", target: "production", rows: batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: b.order ? b.order.customer.name : "Omborga", right: m3(sum(b.qtyM3)), status: `${b.shift}-smena` })) },
      );
      break;
    }

    case "SUPERVISOR": {
      const [openTasks, overdue, todayProgress, batches] = await Promise.all([
        db.brigadeTask.findMany({ where: { status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, take: 20, include: { brigade: true, order: { include: { customer: true } } } }),
        db.brigadeTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] }, dueDate: { lt: today } } }),
        db.taskProgress.findMany({ where: { date: { gte: today } }, select: { qty: true } }),
        db.productionBatch.findMany({ where: { date: { gte: today } }, orderBy: { date: "desc" }, take: 10, include: { product: true, order: { include: { customer: true } } } }),
      ]);
      const left = openTasks.reduce((s, t) => s + (sum(t.qty) - sum(t.doneQty)), 0);
      cards.push(
        { key: "tasks", label: "Ochiq topshiriq", value: String(openTasks.length), icon: "list", tone: openTasks.length ? "brand" : "success" },
        { key: "left", label: "Qolgan hajm", value: m3(left), icon: "cube", tone: "info" },
        { key: "overdue", label: "Kechikkan", value: String(overdue), hint: overdue ? "muddati o'tgan" : undefined, icon: "alarm", tone: overdue ? "danger" : "success" },
        { key: "today", label: "Bugun bajarildi", value: m3(todayProgress.reduce((s, p) => s + sum(p.qty), 0)), icon: "checkmark-done", tone: "success" },
      );
      sections.push(
        { title: "Ochiq topshiriqlar", empty: "Topshiriq yo'q", target: "tasks", rows: openTasks.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.brigade.name}`, subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`, right: m3(sum(t.qty) - sum(t.doneQty)), status: t.status, tone: t.dueDate < today ? "danger" as Tone : t.status === "NEW" ? "info" as Tone : "warning" as Tone })) },
        { title: "Bugungi zameslar", empty: "Bugun zames yo'q", target: "production", rows: batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: b.order ? b.order.customer.name : "Omborga", right: m3(sum(b.qtyM3)), status: `${b.shift}-smena` })) },
      );
      break;
    }

    case "LOGISTICS": {
      const [todayTrips, onRoad, planned, ecoErrors] = await Promise.all([
        db.trip.findMany({ where: { OR: [{ createdAt: { gte: today } }, { status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } }] }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 20, include: { order: { include: { customer: true } }, driver: true, vehicle: true } }),
        db.trip.count({ where: { status: { in: ["LOADED", "ON_ROAD"] } } }),
        db.trip.count({ where: { status: "PLANNED" } }),
        db.trip.count({ where: { ecoError: { not: null } } }),
      ]);
      cards.push(
        { key: "today", label: "Bugungi reys", value: String(todayTrips.filter((t) => t.createdAt >= today).length), tone: "brand", icon: "today" },
        { key: "onroad", label: "Yo'lda", value: String(onRoad), tone: "info", icon: "navigate" },
        { key: "planned", label: "Rejada", value: String(planned), tone: "warning", icon: "calendar" },
        { key: "eco", label: "ECO xatosi", value: String(ecoErrors), hint: ecoErrors ? "tekshiring" : undefined, tone: ecoErrors ? "danger" : "success", icon: "phone-portrait" },
      );
      sections.push({ title: "Bugungi reyslar", empty: "Reys yo'q", target: "trips", rows: todayTrips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.driver.fullName} · ${t.vehicle.plate}${t.ecoStatus ? ` · ${ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus}` : ""}`, right: m3(sum(t.qtyM3)), status: t.status, tone: t.ecoError ? "danger" : TRIP_TONE[t.status] })) });
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
      sections.push(
        { title: "Kam qolgan xomashyo", empty: "Hammasi minimumdan yuqori", target: "stock", rows: low.map((m) => ({ id: m.id, title: m.name, subtitle: `Minimum ${sum(m.minStock)} ${m.unit}`, right: `${(bal.get(m.id) ?? 0).toFixed(1)} ${m.unit}`, tone: "danger" })) },
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
      sections.push({ title: "So'nggi kirimlar", empty: "Kirim yo'q", target: "receipts", rows: recent.map((r) => ({ id: r.id, title: `${r.docNo} · ${r.supplier.name}`, subtitle: `${day(r.date)} · ${r.items.length} qator`, right: money(r.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0)) })) });
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
      sections.push(
        // Kassir shu yerdan schyotni ochib to'lovni qabul qiladi
        { title: "Ochiq schyotlar", empty: "Ochiq schyot yo'q", target: "invoices", rows: openInvoices.map((i) => { const left = sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0); return { id: i.id, title: `${i.invoiceNo} · ${i.customer.name}`, subtitle: `${day(i.date)} · jami ${money(sum(i.amount))}`, right: money(left), status: i.status, tone: i.status === "PARTIAL" ? "warning" as Tone : "danger" as Tone }; }) },
        { title: "Bugungi to'lovlar", empty: "Bugun to'lov yo'q", target: "payments", rows: recent.map((p) => ({ id: p.id, title: p.customer.name, subtitle: `${time(p.date)} · ${p.cashAccount.name}`, right: money(sum(p.amount)), tone: "success" })) },
      );
      break;
    }
  }

  return { ...base, cards, sections };
}
