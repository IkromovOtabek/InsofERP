import { db } from "./db";

const DAYS = 30;

/**
 * Xomashyo: qoldiq, o'rtacha kunlik sarf (so'nggi 30 kun), necha kunga yetadi,
 * tasdiqlangan zayavkalar uchun rejadagi ehtiyoj.
 */
export async function materialOutlook() {
  const since = new Date(Date.now() - DAYS * 86400000);
  const [materials, sums, consumed, orders] = await Promise.all([
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", date: { gte: since } }, _sum: { qty: true } }),
    db.order.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      include: { items: { include: { product: { include: { recipes: { where: { isActive: true }, include: { items: true } } } } } }, batches: true },
    }),
  ]);
  const bal = new Map(sums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  const daily = new Map(consumed.map((x) => [x.materialId, -Number(x._sum.qty ?? 0) / DAYS]));

  // Rejadagi ehtiyoj: har zayavkaning ishlab chiqarilmagan qismi × retsept
  const need = new Map<string, number>();
  for (const o of orders) {
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const done = o.batches.reduce((s, b) => s + Number(b.qtyM3), 0);
    const remaining = Math.max(0, total - done);
    if (!remaining) continue;
    for (const i of o.items) {
      const share = remaining * (Number(i.qtyM3) / total);
      // Xomashyo dashboardida faqat xomashyo-ingredientlar hisoblanadi — mahsulot-ingredient o'tkazib yuboriladi
      for (const ri of i.product.recipes[0]?.items ?? []) { if (!ri.materialId) continue; need.set(ri.materialId, (need.get(ri.materialId) ?? 0) + share * Number(ri.qtyPerM3)); }
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
    };
  });
}

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
