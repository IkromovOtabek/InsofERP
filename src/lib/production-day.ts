import { db } from "@/lib/db";
import { dayUtc, monthDays } from "@/lib/davomat";
import { fmtUnitTotals } from "@/lib/unit";
import type { AttendanceStatus } from "@/generated/prisma";

/**
 * Ishlab chiqarish bosh sahifasi va direktorga kunlik hisobot — bitta kun bo'yicha hamma raqamlar.
 * Hisobot sahifasi ham, bosh sahifa ham shu funksiyadan o'qiydi: ikki joyda ikki xil son chiqmasin.
 *
 * Ishlab chiqarilgan miqdor saqlanmaydi — PRODUCTION_OUTPUT (StockMove) yig'indisi:
 * beton zames bilan, dona mahsulot (plita, ustun) brigada qaydi bilan shu jurnalga tushadi.
 */

/** Brak sabablari — formada tayyor ro'yxat, boshqasi izohga yoziladi. */
export const DEFECT_REASONS = ["Yoriq / sinish", "O'lcham mos emas", "Mustahkamlik yetmadi", "Armatura chiqib qolgan", "Tashishda shikastlandi", "Boshqa"];

/** Bosh sahifa ishlab chiqarish ko'rinishida ochiladigan rollar (direktor — `?view=production`). */
export const PRODUCTION_HOME_ROLES = ["PRODUCTION", "SUPERVISOR"] as const;

/** Oydagi ish kunlari (yakshanbasiz) — kunlik plan bo'sh bo'lsa oylik plan shunga bo'linadi. */
export const workDays = (ym: string) => monthDays(ym).filter((d) => !d.weekend);

const LOAD_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"] as const;

/** "YYYY-MM-DD" (mahalliy kun) → [kun boshi, ertasi kun boshi) mahalliy vaqtda. */
function localRange(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { from: new Date(y, m - 1, d), to: new Date(y, m - 1, d + 1), monthFrom: new Date(y, m - 1, 1) };
}

type Sum = Map<string, number>;
const add = (m: Sum, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export async function productionDay(iso: string) {
  const { from, to, monthFrom } = localRange(iso);
  const ym = iso.slice(0, 7);
  const [year, month] = ym.split("-").map(Number);

  const [employees, attendance, brigades, progressToday, progressMonth, openTasks, loadOrders, outputs, plans, defects, products] = await Promise.all([
    db.employee.findMany({ where: { isActive: true, firedAt: null }, select: { id: true, fullName: true, position: true }, orderBy: { fullName: "asc" } }),
    db.attendance.findMany({ where: { date: dayUtc(iso) }, select: { employeeId: true, status: true, checkIn: true, checkOut: true } }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { fullName: true } } } }),
    db.taskProgress.findMany({
      where: { date: { gte: from, lt: to } },
      orderBy: { date: "asc" },
      select: { qty: true, date: true, note: true, createdBy: { select: { fullName: true } }, task: { select: { taskNo: true, brigadeId: true, order: { select: { orderNo: true } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } } } },
    }),
    db.taskProgress.findMany({ where: { date: { gte: monthFrom, lt: to } }, select: { qty: true, task: { select: { brigadeId: true, orderItem: { select: { product: { select: { unit: true } } } } } } } }),
    db.brigadeTask.findMany({ where: { status: { in: ["NEW", "IN_PROGRESS"] } }, select: { brigadeId: true, dueDate: true } }),
    db.order.findMany({
      where: { kind: "SALE", deliveryDate: { gte: from, lt: to }, status: { in: [...LOAD_STATUSES] } },
      orderBy: [{ deliveryTime: "asc" }, { orderNo: "asc" }],
      select: {
        id: true, orderNo: true, deliveryTime: true, status: true, needsDelivery: true, customerId: true,
        customer: { select: { name: true } },
        items: { select: { qtyM3: true, product: { select: { id: true, code: true, name: true, unit: true } } } },
        trips: { where: { status: { not: "CANCELLED" } }, select: { qtyM3: true } },
      },
    }),
    db.stockMove.findMany({ where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: monthFrom, lt: to } }, select: { productId: true, qty: true, date: true } }),
    db.productionPlan.findMany({ where: { year, month }, include: { product: { select: { id: true, code: true, name: true, unit: true } }, setBy: { select: { fullName: true } } } }),
    db.productDefect.findMany({
      where: { date: { gte: monthFrom, lt: to } },
      orderBy: { date: "desc" },
      include: { product: { select: { id: true, code: true, name: true, unit: true } }, brigade: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
    db.product.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, unit: true }, orderBy: { code: "asc" } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));

  // ── 1–2. Xodimlar va davomat ──
  const byPosition = new Map<string, number>();
  for (const e of employees) add(byPosition, e.position || "—", 1);
  const attByEmp = new Map(attendance.map((a) => [a.employeeId, a]));
  const count = (st: AttendanceStatus) => attendance.filter((a) => a.status === st && employees.some((e) => e.id === a.employeeId)).length;
  const present = employees
    .filter((e) => attByEmp.get(e.id)?.status === "PRESENT")
    .map((e) => ({ ...e, checkIn: attByEmp.get(e.id)!.checkIn, checkOut: attByEmp.get(e.id)!.checkOut }))
    .sort((a, b) => (a.checkIn ?? "99").localeCompare(b.checkIn ?? "99"));
  const away = employees
    .filter((e) => { const st = attByEmp.get(e.id)?.status; return st && st !== "PRESENT"; })
    .map((e) => ({ ...e, status: attByEmp.get(e.id)!.status }));
  const notMarked = employees.filter((e) => !attByEmp.has(e.id));

  // ── 4. Brigadalar ishi ──
  const brigadeRows = brigades.map((b) => {
    const today = progressToday.filter((p) => p.task.brigadeId === b.id);
    const monthRows = progressMonth.filter((p) => p.task.brigadeId === b.id);
    const open = openTasks.filter((t) => t.brigadeId === b.id);
    return {
      id: b.id, name: b.name, leader: b.leader?.fullName ?? null,
      today: today.map((p) => ({ qty: Number(p.qty), unit: p.task.orderItem.product.unit, product: p.task.orderItem.product.name, taskNo: p.task.taskNo, orderNo: p.task.order.orderNo, by: p.createdBy.fullName, at: p.date, note: p.note })),
      todayText: fmtUnitTotals(today.map((p) => ({ unit: p.task.orderItem.product.unit, qty: p.qty }))),
      monthText: fmtUnitTotals(monthRows.map((p) => ({ unit: p.task.orderItem.product.unit, qty: p.qty }))),
      openCount: open.length,
      overdue: open.filter((t) => t.dueDate < from).length,
    };
  });

  // ── 5. Bugun yuklanadigan mahsulot ──
  const loadByProduct = new Map<string, { id: string; code: string; name: string; unit: string; need: number; orders: number }>();
  const loadOrderRows = loadOrders.map((o) => {
    const need = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const shipped = o.trips.reduce((s, t) => s + Number(t.qtyM3), 0);
    for (const i of o.items) {
      const cur = loadByProduct.get(i.product.id) ?? { ...i.product, need: 0, orders: 0 };
      cur.need += Number(i.qtyM3); cur.orders += 1;
      loadByProduct.set(i.product.id, cur);
    }
    return {
      id: o.id, orderNo: o.orderNo, time: o.deliveryTime, status: o.status, pickup: !o.needsDelivery, customerId: o.customerId, customer: o.customer.name,
      items: o.items.map((i) => ({ code: i.product.code, unit: i.product.unit, qty: Number(i.qtyM3) })),
      need, shipped, left: Math.max(0, need - shipped),
    };
  });

  // ── 6–7. Ishlab chiqarilgan, plan, brak ──
  const outMonth: Sum = new Map(), outDay: Sum = new Map();
  for (const m of outputs) {
    add(outMonth, m.productId!, Number(m.qty));
    if (m.date >= from) add(outDay, m.productId!, Number(m.qty));
  }
  const defMonth: Sum = new Map(), defDay: Sum = new Map();
  for (const d of defects) {
    add(defMonth, d.productId, Number(d.qty));
    if (d.date >= from) add(defDay, d.productId, Number(d.qty));
  }
  const wd = workDays(ym);
  const elapsed = wd.filter((d) => d.iso <= iso).length; // shu kungacha o'tgan ish kunlari
  const planRows = plans
    .map((p) => {
      const monthQty = Number(p.monthQty);
      const dayQty = p.dayQty !== null ? Number(p.dayQty) : wd.length ? monthQty / wd.length : 0;
      const factMonth = outMonth.get(p.productId) ?? 0;
      const factDay = outDay.get(p.productId) ?? 0;
      const expected = Math.min(monthQty, dayQty * elapsed); // shu kungacha bajarilishi kerak edi
      return {
        id: p.id, product: p.product, monthQty, dayQty, dayQtyManual: p.dayQty !== null, note: p.note, setBy: p.setBy.fullName, updatedAt: p.updatedAt,
        factDay, factMonth, defectDay: defDay.get(p.productId) ?? 0, defectMonth: defMonth.get(p.productId) ?? 0,
        dayPct: dayQty > 0 ? (factDay / dayQty) * 100 : 0,
        monthPct: monthQty > 0 ? (factMonth / monthQty) * 100 : 0,
        behind: Math.max(0, expected - factMonth),
      };
    })
    .sort((a, b) => a.product.code.localeCompare(b.product.code));

  // Plansiz ishlab chiqarilganlar ham hisobotda ko'rinsin
  const producedIds = new Set([...outMonth.keys(), ...defMonth.keys()]);
  const produced = [...producedIds]
    .map((id) => ({ product: productById.get(id)!, day: outDay.get(id) ?? 0, month: outMonth.get(id) ?? 0, defectDay: defDay.get(id) ?? 0, defectMonth: defMonth.get(id) ?? 0 }))
    .filter((r) => r.product)
    .sort((a, b) => b.day - a.day || b.month - a.month);

  const defectRows = defects.map((d) => ({
    id: d.id, date: d.date, product: d.product, qty: Number(d.qty), reason: d.reason, note: d.note,
    brigade: d.brigade?.name ?? null, by: d.createdBy.fullName, createdById: d.createdById,
  }));
  const byReason = new Map<string, number>();
  for (const d of defects) add(byReason, d.reason, 1);

  return {
    iso, ym, from,
    staff: { total: employees.length, byPosition: [...byPosition].sort((a, b) => b[1] - a[1]) },
    attendance: { present, away, notMarked, absent: count("ABSENT"), leave: count("LEAVE"), sick: count("SICK"), dayoff: count("DAYOFF") },
    brigades: brigadeRows,
    load: { products: [...loadByProduct.values()].sort((a, b) => b.need - a.need), orders: loadOrderRows },
    plan: { rows: planRows, workDays: wd.length, elapsed },
    produced,
    defects: { today: defectRows.filter((d) => d.date >= from), month: defectRows, byReason: [...byReason].sort((a, b) => b[1] - a[1]) },
    products,
  };
}

export type ProductionDay = Awaited<ReturnType<typeof productionDay>>;
