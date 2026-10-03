import { db } from "./db";

const DAYS = 30;

/**
 * Xomashyo: qoldiq, o'rtacha kunlik sarf (so'nggi 30 kun), necha kunga yetadi,
 * tasdiqlangan zayavkalar uchun rejadagi ehtiyoj.
 */
/**
 * `until` — faqat shu vaqtgacha yetkazilishi kerak bo'lgan zayavkalar ehtiyoji (dashboard davr filtri:
 * "bugun" — bugungacha, "hafta" — hafta oxirigacha; kechikkanlar ham kiradi). Berilmasa — hamma ochiq zayavka.
 */
export async function materialOutlook(opts: { until?: Date } = {}) {
  const since = new Date(Date.now() - DAYS * 86400000);
  const [materials, sums, consumed, orders] = await Promise.all([
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", date: { gte: since } }, _sum: { qty: true } }),
    db.order.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, ...(opts.until ? { deliveryDate: { lt: opts.until } } : {}) },
      include: { customer: { select: { name: true } }, items: { include: { task: { select: { doneQty: true } }, product: { include: { recipes: { where: { isActive: true }, include: { items: true } } } } } }, batches: { where: { cancelledAt: null } } },
    }),
  ]);
  const bal = new Map(sums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  const daily = new Map(consumed.map((x) => [x.materialId, -Number(x._sum.qty ?? 0) / DAYS]));

  // Rejadagi ehtiyoj: har zayavkaning hali ishlab chiqarilmagan qismi × retsept.
  // Beton (m³) — zames bilan qilingani ayriladi; dona mahsulot — brigada topshirig'ida bajarilgani.
  const need = new Map<string, number>();
  const byOrder = new Map<string, MaterialOrderNeed[]>();
  for (const o of orders) {
    const m3Total = o.items.filter((i) => i.product.unit === "m3").reduce((s, i) => s + Number(i.qtyM3), 0);
    const m3Done = o.batches.reduce((s, b) => s + Number(b.qtyM3), 0);
    const m3Left = Math.max(0, m3Total - m3Done);
    const perMat = new Map<string, number>();
    for (const i of o.items) {
      const left = i.product.unit === "m3"
        ? (m3Total > 0 ? m3Left * (Number(i.qtyM3) / m3Total) : 0)
        : Math.max(0, Number(i.qtyM3) - Number(i.task?.doneQty ?? 0));
      if (left <= 0) continue;
      // Xomashyo dashboardida faqat xomashyo-ingredientlar hisoblanadi — mahsulot-ingredient o'tkazib yuboriladi
      for (const ri of i.product.recipes[0]?.items ?? []) { if (!ri.materialId) continue; perMat.set(ri.materialId, (perMat.get(ri.materialId) ?? 0) + left * Number(ri.qtyPerM3)); }
    }
    for (const [mid, q] of perMat) {
      need.set(mid, (need.get(mid) ?? 0) + q);
      byOrder.set(mid, [...(byOrder.get(mid) ?? []), { id: o.id, orderNo: o.orderNo, customer: o.customer.name, date: o.deliveryDate, qty: q }]);
    }
  }

  return materials.map((m) => {
    const balance = bal.get(m.id) ?? 0;
    const perDay = daily.get(m.id) ?? 0;
    const planned = need.get(m.id) ?? 0;
    return {
      id: m.id, name: m.name, unit: m.unit, balance, minStock: Number(m.minStock), perDay, planned,
      days: perDay > 0 ? balance / perDay : null,
      short: balance < planned,
      /** Zayavkalarga yetmayotgan miqdor (0 — yetadi). */
      orderGap: Math.max(0, planned - balance),
      /** Qaysi zayavkaga qancha kerak — yetkazish sanasi bo'yicha. */
      orders: (byOrder.get(m.id) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime()),
    };
  });
}
export type MaterialOrderNeed = { id: string; orderNo: string; customer: string; date: Date; qty: number };

/** Mikserlar: hozir qayerda, bugun nechta reys. */
export async function mixerStatus() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const vehicles = await db.vehicle.findMany({
    where: { isActive: true, type: "MIXER" }, orderBy: { plate: "asc" },
    include: {
      trips: {
        where: { OR: [{ status: { in: ["LOADED", "ON_ROAD"] } }, { createdAt: { gte: today } }] },
        include: { order: { include: { customer: true } }, driver: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return vehicles.map((v) => {
    const active = v.trips.find((t) => t.status === "LOADED" || t.status === "ON_ROAD");
    const todayTrips = v.trips.filter((t) => t.createdAt >= today && t.status !== "CANCELLED");
    return {
      id: v.id, plate: v.plate, capacityM3: v.capacityM3 ? Number(v.capacityM3) : null,
      active: active ? { id: active.id, noteNo: active.deliveryNoteNo, status: active.status, customerId: active.order.customerId, customer: active.order.customer.name, driver: active.driver.fullName, qtyM3: Number(active.qtyM3) } : null,
      todayCount: todayTrips.length,
      todayM3: todayTrips.reduce((s, t) => s + Number(t.qtyM3), 0),
    };
  });
}

/** Bugungi reyslar (bugun yaratilgan yoki hali yopilmagan). */
export async function todayTrips() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return db.trip.findMany({
    where: { OR: [{ createdAt: { gte: today } }, { status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } }] },
    include: { order: { include: { customer: true } }, vehicle: true, driver: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });
}
