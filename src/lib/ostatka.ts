import { db } from "./db";

/**
 * Hovlida turgan tayyor mahsulot qoldig'i (dona mahsulotlar) — Sklad → "Ishlab chiqarish imkoni"
 * bo'limida va sotuv/zayavka panelida ko'rsatiladi (ilgari alohida "Astatka" sahifasi edi).
 * jami = StockMove (PRODUCTION_OUTPUT + / SHIPMENT −)
 * egasi bor = tasdiqlangan zayavkalarda band qilingan, hali jo'natilmagan
 * egasi yo'q = jami − egasi bor
 */
export async function ostatkaSummary() {
  const [products, sums, orders] = await Promise.all([
    db.product.findMany({ where: { isActive: true, unit: { not: "m3" } }, orderBy: { code: "asc" } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    db.order.findMany({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, include: { items: true, trips: { where: { status: { not: "CANCELLED" } } } } }),
  ]);
  const bal = new Map(sums.map((x) => [x.productId, Number(x._sum.qty ?? 0)]));
  const reserved = new Map<string, number>();
  for (const o of orders) {
    const shipped = o.trips.reduce((s, t) => s + Number(t.qtyM3), 0);
    for (const i of o.items) reserved.set(i.productId, (reserved.get(i.productId) ?? 0) + Math.max(0, Number(i.qtyM3) - shipped));
  }
  return products.map((p) => {
    const total = bal.get(p.id) ?? 0;
    const owned = Math.min(total, reserved.get(p.id) ?? 0);
    return { ...p, total, owned, free: total - owned, shortage: Math.max(0, (reserved.get(p.id) ?? 0) - total) };
  });
}

/** Bitta mahsulot bo'yicha: kimga band qilingan, partiyalar, harakatlar. */
export async function ostatkaDetail(productId: string) {
  const [product, sum, orders, batches, moves] = await Promise.all([
    db.product.findUnique({ where: { id: productId } }),
    db.stockMove.aggregate({ where: { productId }, _sum: { qty: true } }),
    db.order.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, items: { some: { productId } } },
      include: { customer: true, items: { where: { productId } }, trips: { where: { status: { not: "CANCELLED" } } } },
      orderBy: { deliveryDate: "asc" },
    }),
    db.productionBatch.findMany({ where: { productId }, orderBy: { date: "desc" }, take: 30, include: { createdBy: true, order: true } }),
    db.stockMove.findMany({ where: { productId }, orderBy: { createdAt: "desc" }, take: 50, include: { createdBy: true } }),
  ]);
  if (!product) return null;
  const total = Number(sum._sum.qty ?? 0);
  const owners = orders.map((o) => {
    const shipped = o.trips.reduce((s, t) => s + Number(t.qtyM3), 0);
    const qty = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    return { orderId: o.id, orderNo: o.orderNo, customer: o.customer.name, phone: o.customer.phone, deliveryDate: o.deliveryDate, status: o.status, qty, shipped, reserved: Math.max(0, qty - shipped) };
  }).filter((x) => x.reserved > 0);
  const reservedTotal = owners.reduce((s, x) => s + x.reserved, 0);
  return { product, total, owned: Math.min(total, reservedTotal), free: Math.max(0, total - reservedTotal), shortage: Math.max(0, reservedTotal - total), owners, batches, moves };
}
