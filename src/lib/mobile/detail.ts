import { db } from "@/lib/db";
import { customerCredit } from "@/lib/finance";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import type { MobileUser } from "./auth";
import type { HomeSection, Tone } from "./home";
import { ListError } from "./list";
import type { Role } from "@/generated/prisma";

/**
 * Bitta hujjat kartochkasi — ro'yxatdagi qator bosilganda ochiladi.
 *
 * Nima ko'rinishi va qaysi tugmalar borligini server hal qiladi: ilova faqat chizadi.
 * Shuning uchun yangi amal qo'shish uchun ilovani qayta chiqarish shart emas —
 * `actions` ro'yxatiga qator qo'shiladi, mos ijro `lib/mobile/actions.ts` da yoziladi.
 */
export type DetailField = { label: string; value: string; tone?: Tone };
export type FormOption = {
  value: string;
  label: string;
  /** Tanlanganda boshqa maydonlarni to'ldirish uchun (masalan mahsulot narxi). */
  extra?: Record<string, string>;
};
export type FormField = {
  name: string;
  label: string;
  /** `items` — takrorlanuvchi qatorlar (zayavka mahsulotlari); ustunlari `columns` da. */
  type: "text" | "number" | "date" | "time" | "select" | "switch" | "items";
  required?: boolean;
  placeholder?: string;
  /** Boshlang'ich qiymat. Switch uchun "true"/"false". */
  value?: string;
  /** Maydon ostidagi kichik izoh. */
  hint?: string;
  options?: FormOption[];
  /** Shart: boshqa maydon shu qiymatda bo'lsagina ko'rinadi. */
  showIf?: { field: string; equals: string };
  columns?: FormField[];
};
export type DetailAction = {
  id: string;
  label: string;
  tone?: "brand" | "danger" | "success" | "warning";
  /** Bosilganda ko'rsatiladigan savol — bo'lsa tasdiqlash so'raladi. */
  confirm?: string;
  /** Bo'lsa — avval shu maydonlar so'raladi. */
  form?: FormField[];
};
export type MobileDetail = {
  key: string;
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  fields: DetailField[];
  sections: HomeSection[];
  actions: DetailAction[];
};

const sum = (n: unknown) => Number(n ?? 0);
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const m3 = (n: number) => `${sum(n).toFixed(sum(n) % 1 ? 1 : 0)} m³`;
const day = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const dt = (d: Date) => `${day(d)} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };

/** Amalga kim haqli — veb ERP'dagi `requireSession([...])` bilan bir xil ro'yxat. */
export const ACTION_ROLES: Record<string, Role[]> = {
  "order.confirm": ["SALES"],
  "order.unblock": ["DIRECTOR"],
  "order.cancel": ["SALES"],
  "trip.loaded": ["LOGISTICS", "PRODUCTION"],
  "trip.onroad": ["LOGISTICS", "PRODUCTION"],
  "trip.delivered": ["LOGISTICS", "PRODUCTION"],
  "trip.cancel": ["LOGISTICS"],
  "trip.eco": ["LOGISTICS"],
  "invoice.pay": ["CASHIER", "ACCOUNTING"],
  "task.progress": ["SUPERVISOR", "PRODUCTION", "LOGISTICS"],
  "task.cancel": ["SUPERVISOR", "PRODUCTION", "SALES"],
};

export const can = (user: MobileUser, action: string) =>
  user.role === "DIRECTOR" || (ACTION_ROLES[action] ?? []).includes(user.role);

export async function mobileDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (!id) throw new ListError("BAD_REQUEST", "id yo'q", 400);
  switch (key) {
    case "orders": return orderDetail(user, id);
    case "trips": return tripDetail(user, id);
    case "invoices": return invoiceDetail(user, id);
    case "payments": return paymentDetail(id);
    case "receipts": return receiptDetail(id);
    case "tasks": return taskDetail(user, id);
    case "production": return batchDetail(id);
    case "stock": return materialDetail(id);
    case "employees": return employeeDetail(id);
    case "cashflow": return cashflowDetail(id);
    default: throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  }
}

// ───────────────────────── Zayavka ─────────────────────────

async function orderDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const o = await db.order.findUnique({
    where: { id },
    include: { customer: true, items: { include: { product: true } }, trips: { include: { driver: true, vehicle: true } }, batches: { include: { product: true } }, invoices: true, createdBy: true },
  });
  if (!o) throw new ListError("NOT_FOUND", "Zayavka topilmadi", 404);
  const credit = await customerCredit(o.customerId);
  const total = o.items.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0);
  const volume = o.items.reduce((s, i) => s + sum(i.qtyM3), 0);
  const produced = o.batches.reduce((s, b) => s + sum(b.qtyM3), 0);
  const delivered = o.trips.filter((t) => t.status === "DELIVERED").reduce((s, t) => s + sum(t.qtyM3), 0);

  const actions: DetailAction[] = [];
  if (o.status === "DRAFT" && can(user, "order.confirm")) actions.push({ id: "order.confirm", label: "Qabul qilish", tone: "success", confirm: "Zayavka qabul qilinsinmi? Kredit limiti tekshiriladi." });
  if (o.status === "BLOCKED" && can(user, "order.unblock")) actions.push({ id: "order.unblock", label: "Blokni ochish", tone: "warning", confirm: `Limit oshgan (${money(credit.used)} / ${money(credit.limit)}). Baribir ochilsinmi?` });
  if (["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status) && can(user, "order.cancel")) actions.push({ id: "order.cancel", label: "Bekor qilish", tone: "danger", confirm: "Zayavka bekor qilinsinmi?" });

  return {
    key: "orders", id: o.id, title: o.orderNo, subtitle: o.customer.name, status: o.status,
    fields: [
      { label: "Yetkazish", value: `${day(o.deliveryDate)}${o.deliveryTime ? ` · ${o.deliveryTime}` : ""}` },
      { label: "Manzil", value: o.deliveryAddress },
      { label: "Hajm", value: m3(volume) },
      { label: "Summa", value: money(total) },
      { label: "Ishlab chiqarildi", value: `${m3(produced)} / ${m3(volume)}`, tone: produced >= volume ? "success" : "warning" },
      { label: "Yetkazildi", value: `${m3(delivered)} / ${m3(volume)}`, tone: delivered >= volume ? "success" : "info" },
      { label: "Mijoz limiti", value: `${money(credit.used)} / ${money(credit.limit)}`, tone: credit.used >= credit.limit ? "danger" : "success" },
      ...(o.needsPump ? [{ label: "Nasos", value: "Kerak", tone: "warning" as Tone }] : []),
      ...(o.isUrgent ? [{ label: "Shoshilinch", value: "Ha", tone: "danger" as Tone }] : []),
      ...(o.onCredit ? [{ label: "Qarzga", value: o.guaranteeAt ? `Kafolat xati bor (${day(o.guaranteeAt)})` : "Kafolat xati yo'q", tone: o.guaranteeAt ? "success" as Tone : "danger" as Tone }] : []),
      ...(o.contractNo ? [{ label: "Shartnoma", value: `${o.contractNo}${o.contractAmount ? ` · ${money(sum(o.contractAmount))}` : ""}` }] : []),
      { label: "Kim kiritdi", value: `${o.createdBy.fullName} · ${day(o.date)}` },
      ...(o.note ? [{ label: "Izoh", value: o.note }] : []),
    ],
    sections: [
      { title: "Mahsulotlar", empty: "Qator yo'q", rows: o.items.map((i) => ({ id: i.id, title: i.product.name, subtitle: `${money(sum(i.price))} / m³`, right: m3(sum(i.qtyM3)) })) },
      { title: "Reyslar", empty: "Reys yo'q", target: "trips", rows: o.trips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.vehicle.plate}`, subtitle: t.driver.fullName, right: m3(sum(t.qtyM3)), status: t.status, tone: TRIP_TONE[t.status] })) },
      { title: "Zameslar", empty: "Zames yo'q", target: "production", rows: o.batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: day(b.date), right: m3(sum(b.qtyM3)) })) },
      { title: "Schyotlar", empty: "Schyot yo'q", target: "invoices", rows: o.invoices.map((i) => ({ id: i.id, title: i.invoiceNo, subtitle: day(i.date), right: money(sum(i.amount)), status: i.status })) },
    ].filter((s) => s.rows.length > 0 || s.title === "Mahsulotlar"),
    actions,
  };
}

// ───────────────────────── Reys / nakladnoy ─────────────────────────

async function tripDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true } }, driver: true, vehicle: true } });
  if (!t) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);

  const actions: DetailAction[] = [];
  if (t.status === "PLANNED" && can(user, "trip.loaded")) actions.push({ id: "trip.loaded", label: "Yuklandi", tone: "brand", confirm: "Beton yuklandi deb belgilansinmi? Skladdan chiqim yoziladi." });
  if (["PLANNED", "LOADED"].includes(t.status) && can(user, "trip.onroad")) actions.push({ id: "trip.onroad", label: "Yo'lga chiqdi", tone: "brand" });
  if (["PLANNED", "LOADED", "ON_ROAD"].includes(t.status) && can(user, "trip.delivered")) {
    actions.push({ id: "trip.delivered", label: "Yetkazildi", tone: "success", form: [{ name: "receiverName", label: "Obyektda kim qabul qildi", type: "text", required: true, placeholder: "F.I.Sh." }, { name: "note", label: "Izoh", type: "text" }] });
  }
  if (t.status === "PLANNED" && can(user, "trip.cancel")) actions.push({ id: "trip.cancel", label: "Bekor qilish", tone: "danger", confirm: "Reys bekor qilinsinmi?" });
  if (ecoEnabled() && can(user, "trip.eco")) actions.push({ id: "trip.eco", label: t.ecoDeliveryId ? "ECO'ga qayta yuborish" : "ECO'ga yuborish", tone: "warning" });

  return {
    key: "trips", id: t.id, title: t.deliveryNoteNo, subtitle: t.order.customer.name, status: t.status,
    fields: [
      { label: "Haydovchi", value: t.driver.fullName },
      { label: "Telefon", value: t.driver.phone ?? "—", tone: t.driver.phone ? undefined : "danger" },
      { label: "Mashina", value: t.vehicle.plate },
      { label: "Hajm", value: m3(sum(t.qtyM3)) },
      { label: "Manzil", value: t.order.deliveryAddress },
      { label: "Zayavka", value: t.order.orderNo },
      ...(t.loadedAt ? [{ label: "Yuklandi", value: dt(t.loadedAt) }] : []),
      ...(t.deliveredAt ? [{ label: "Yetkazildi", value: dt(t.deliveredAt) }] : []),
      ...(t.receiverName ? [{ label: "Qabul qildi", value: t.receiverName }] : []),
      ...(t.ecoStatus ? [{ label: "Haydovchi ilovasi", value: ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus, tone: "info" as Tone }] : []),
      ...(t.ecoSyncedAt ? [{ label: "ECO sinxron", value: dt(t.ecoSyncedAt) }] : []),
      ...(t.ecoError ? [{ label: "ECO xatosi", value: t.ecoError, tone: "danger" as Tone }] : []),
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
    ],
    sections: [],
    actions,
  };
}

// ───────────────────────── Schyot ─────────────────────────

async function invoiceDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const inv = await db.invoice.findUnique({ where: { id }, include: { customer: true, order: true, payments: { include: { cashAccount: true }, orderBy: { date: "desc" } } } });
  if (!inv) throw new ListError("NOT_FOUND", "Schyot topilmadi", 404);
  const paid = inv.payments.reduce((s, p) => s + sum(p.amount), 0);
  const left = sum(inv.amount) - paid;

  const actions: DetailAction[] = [];
  if (["OPEN", "PARTIAL"].includes(inv.status) && can(user, "invoice.pay")) {
    const accounts = await db.cashAccount.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { _count: { select: { payments: true, transactions: true } } },
    });
    // Ko'p ishlatilgani birinchi turadi; bir xil nomlilar bo'lsa id oxiri bilan ajratiladi
    // (bazada bir nechta bir xil nomli kassa bo'lib qolishi mumkin).
    const byName = new Map<string, number>();
    for (const a of accounts) byName.set(a.name, (byName.get(a.name) ?? 0) + 1);
    const sorted = [...accounts].sort((a, b) => (b._count.payments + b._count.transactions) - (a._count.payments + a._count.transactions));
    actions.push({
      id: "invoice.pay", label: "To'lov qabul qilish", tone: "success",
      form: [
        { name: "amount", label: "Summa (so'm)", type: "number", required: true, value: String(Math.round(left)) },
        {
          name: "cashAccountId", label: "Qayerga tushdi", type: "select", required: true, value: sorted[0]?.id,
          options: sorted.map((a) => ({
            value: a.id,
            label: `${a.name} (${a.type === "CASH" ? "kassa" : "bank"})${(byName.get(a.name) ?? 0) > 1 ? ` · ${a.id.slice(-4)}` : ""}`,
          })),
        },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }

  return {
    key: "invoices", id: inv.id, title: inv.invoiceNo, subtitle: inv.customer.name, status: inv.status,
    fields: [
      { label: "Sana", value: day(inv.date) },
      { label: "Jami", value: money(sum(inv.amount)) },
      { label: "To'landi", value: money(paid), tone: "success" },
      { label: "Qoldiq", value: money(left), tone: left > 0 ? "danger" : "success" },
      ...(inv.order ? [{ label: "Zayavka", value: inv.order.orderNo }] : []),
    ],
    sections: [{ title: "To'lovlar", empty: "To'lov yo'q", target: "payments", rows: inv.payments.map((p) => ({ id: p.id, title: money(sum(p.amount)), subtitle: `${day(p.date)} · ${p.cashAccount.name}`, tone: "success" as Tone })) }],
    actions,
  };
}

// ───────────────────────── Qolganlari — faqat ko'rish ─────────────────────────

async function paymentDetail(id: string): Promise<MobileDetail> {
  const p = await db.payment.findUnique({ where: { id }, include: { customer: true, cashAccount: true, invoice: true, order: true } });
  if (!p) throw new ListError("NOT_FOUND", "To'lov topilmadi", 404);
  return {
    key: "payments", id: p.id, title: money(sum(p.amount)), subtitle: p.customer.name,
    fields: [
      { label: "Sana", value: dt(p.date) },
      { label: "Hisob", value: p.cashAccount.name },
      ...(p.invoice ? [{ label: "Schyot", value: p.invoice.invoiceNo }] : []),
      ...(p.order ? [{ label: "Zayavka", value: p.order.orderNo }] : []),
      ...(p.note ? [{ label: "Izoh", value: p.note }] : []),
    ],
    sections: [], actions: [],
  };
}

async function receiptDetail(id: string): Promise<MobileDetail> {
  const r = await db.goodsReceipt.findUnique({ where: { id }, include: { supplier: true, warehouse: true, createdBy: true, items: { include: { material: true } } } });
  if (!r) throw new ListError("NOT_FOUND", "Kirim topilmadi", 404);
  const total = r.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0);
  return {
    key: "receipts", id: r.id, title: r.docNo, subtitle: r.supplier.name,
    fields: [
      { label: "Sana", value: day(r.date) },
      { label: "Ombor", value: r.warehouse.name },
      { label: "Jami", value: money(total) },
      ...(r.createdBy ? [{ label: "Kim kiritdi", value: r.createdBy.fullName }] : []),
      ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
    ],
    sections: [{ title: "Qatorlar", empty: "Qator yo'q", rows: r.items.map((i) => ({ id: i.id, title: i.material.name, subtitle: `${money(sum(i.price))} / ${i.material.unit}`, right: `${sum(i.qty)} ${i.material.unit}` })) }],
    actions: [],
  };
}

async function taskDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.brigadeTask.findUnique({
    where: { id },
    include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } }, progress: { orderBy: { date: "desc" }, include: { createdBy: true } } },
  });
  if (!t) throw new ListError("NOT_FOUND", "Topshiriq topilmadi", 404);
  const left = sum(t.qty) - sum(t.doneQty);
  const open = !["DONE", "CANCELLED"].includes(t.status);

  const actions: DetailAction[] = [];
  if (open && can(user, "task.progress")) {
    actions.push({
      id: "task.progress", label: "Bajarilgan miqdorni qayd qilish", tone: "success",
      form: [
        { name: "qty", label: `Miqdor (m³) — qoldiq ${left.toFixed(1)}`, type: "number", required: true, value: String(left) },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }
  if (open && can(user, "task.cancel")) actions.push({ id: "task.cancel", label: "Bekor qilish", tone: "danger", confirm: "Topshiriq bekor qilinsinmi?" });

  return {
    key: "tasks", id: t.id, title: t.taskNo, subtitle: `${t.brigade.name} · ${t.order.customer.name}`, status: t.status,
    fields: [
      { label: "Mahsulot", value: t.orderItem.product.name },
      { label: "Topshiriq", value: m3(sum(t.qty)) },
      { label: "Bajarildi", value: `${m3(sum(t.doneQty))} / ${m3(sum(t.qty))}`, tone: left <= 0 ? "success" : "warning" },
      { label: "Qoldiq", value: m3(left), tone: left > 0 ? "warning" : "success" },
      { label: "Muddat", value: day(t.dueDate), tone: open && t.dueDate < new Date() ? "danger" : undefined },
      { label: "Zayavka", value: t.order.orderNo },
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
    ],
    sections: [{
      title: "Bajarilganlik qaydlari", empty: "Hali qayd yo'q",
      rows: t.progress.map((p) => ({ id: p.id, title: m3(sum(p.qty)), subtitle: `${day(p.date)} · ${p.createdBy.fullName}${p.note ? ` · ${p.note}` : ""}`, tone: "success" as Tone })),
    }],
    actions,
  };
}

async function batchDetail(id: string): Promise<MobileDetail> {
  const b = await db.productionBatch.findUnique({ where: { id }, include: { product: true, recipe: { include: { items: { include: { material: true } } } }, order: { include: { customer: true } }, createdBy: true } });
  if (!b) throw new ListError("NOT_FOUND", "Zames topilmadi", 404);
  return {
    key: "production", id: b.id, title: b.batchNo, subtitle: b.product.name,
    fields: [
      { label: "Sana", value: dt(b.date) },
      { label: "Smena", value: `${b.shift}-smena` },
      { label: "Hajm", value: m3(sum(b.qtyM3)) },
      { label: "Zayavka", value: b.order ? `${b.order.orderNo} · ${b.order.customer.name}` : "Omborga" },
      { label: "Retsept", value: `${b.product.name} · v${b.recipe.version}` },
      { label: "Kim kiritdi", value: b.createdBy.fullName },
    ],
    sections: [{
      title: "Sarflangan xomashyo", empty: "Retsept bo'sh",
      rows: b.recipe.items.map((i) => ({ id: i.id, title: i.material.name, subtitle: `${sum(i.qtyPerM3)} ${i.material.unit} / m³`, right: `${(sum(i.qtyPerM3) * sum(b.qtyM3)).toFixed(1)} ${i.material.unit}` })),
    }],
    actions: [],
  };
}

async function materialDetail(id: string): Promise<MobileDetail> {
  const m = await db.material.findUnique({ where: { id } });
  if (!m) throw new ListError("NOT_FOUND", "Xomashyo topilmadi", 404);
  const [agg, moves] = await Promise.all([
    db.stockMove.aggregate({ where: { materialId: id }, _sum: { qty: true } }),
    db.stockMove.findMany({ where: { materialId: id }, orderBy: { date: "desc" }, take: 20, include: { createdBy: true } }),
  ]);
  const balance = sum(agg._sum.qty);
  const MOVE_LABEL: Record<string, string> = { RECEIPT: "Kirim", PRODUCTION_CONSUME: "Ishlab chiqarishga", SHIPMENT: "Chiqim", ADJUSTMENT: "Tuzatish", WRITE_OFF: "Hisobdan chiqarish", TRANSFER: "Ko'chirish" };
  return {
    key: "stock", id: m.id, title: m.name, subtitle: m.code,
    fields: [
      { label: "Qoldiq", value: `${balance.toFixed(1)} ${m.unit}`, tone: balance < sum(m.minStock) ? "danger" : "success" },
      { label: "Minimum", value: `${sum(m.minStock)} ${m.unit}` },
      { label: "Holat", value: m.isActive ? "Faol" : "Nofaol" },
    ],
    sections: [{
      title: "So'nggi harakatlar", empty: "Harakat yo'q",
      rows: moves.map((mv) => ({ id: mv.id, title: MOVE_LABEL[mv.type] ?? mv.type, subtitle: `${day(mv.date)}${mv.createdBy ? ` · ${mv.createdBy.fullName}` : ""}`, right: `${sum(mv.qty) > 0 ? "+" : ""}${sum(mv.qty).toFixed(1)} ${m.unit}`, tone: sum(mv.qty) > 0 ? ("success" as Tone) : ("danger" as Tone) })),
    }],
    actions: [],
  };
}

async function employeeDetail(id: string): Promise<MobileDetail> {
  const e = await db.employee.findUnique({ where: { id }, include: { user: true, trips: { orderBy: { createdAt: "desc" }, take: 10, include: { order: { include: { customer: true } } } } } });
  if (!e) throw new ListError("NOT_FOUND", "Xodim topilmadi", 404);
  return {
    key: "employees", id: e.id, title: e.fullName, subtitle: e.position, status: e.isActive ? "Faol" : "Nofaol",
    fields: [
      { label: "Telefon", value: e.phone ?? "—" },
      { label: "Tizim logini", value: e.user ? e.user.login : "yo'q" },
      { label: "Haydovchi ilovasi", value: e.ecoUserId ? (e.ecoActive ? "Ulangan" : "Nofaol") : "Ulanmagan", tone: e.ecoUserId && e.ecoActive ? "success" : e.ecoError ? "danger" : "info" },
      ...(e.ecoError ? [{ label: "ECO xatosi", value: e.ecoError, tone: "danger" as Tone }] : []),
      { label: "Ishga olingan", value: day(e.createdAt) },
    ],
    sections: e.trips.length
      ? [{ title: "So'nggi reyslar", empty: "Reys yo'q", target: "trips", rows: e.trips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: day(t.createdAt), right: m3(sum(t.qtyM3)), status: t.status, tone: TRIP_TONE[t.status] })) }]
      : [],
    actions: [],
  };
}

async function cashflowDetail(id: string): Promise<MobileDetail> {
  const t = await db.cashTransaction.findUnique({ where: { id }, include: { cashAccount: true, supplier: true, createdBy: true } });
  if (!t) throw new ListError("NOT_FOUND", "Yozuv topilmadi", 404);
  return {
    key: "cashflow", id: t.id, title: `${t.type === "EXPENSE" ? "−" : "+"}${money(sum(t.amount))}`, subtitle: t.category,
    fields: [
      { label: "Sana", value: day(t.date) },
      { label: "Turi", value: t.type === "EXPENSE" ? "Chiqim" : "Kirim", tone: t.type === "EXPENSE" ? "danger" : "success" },
      { label: "Hisob", value: t.cashAccount.name },
      ...(t.counterparty ? [{ label: "Kimga / kimdan", value: t.counterparty }] : []),
      ...(t.supplier ? [{ label: "Yetkazuvchi", value: t.supplier.name }] : []),
      { label: "Kim kiritdi", value: t.createdBy.fullName },
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
    ],
    sections: [], actions: [],
  };
}

