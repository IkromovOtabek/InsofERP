import { db } from "./db";
import { ostatkaSummary } from "./ostatka";

/** Har bir xomashyo bo'yicha joriy qoldiq (barcha skladlar). */
export async function materialBalances() {
  const materials = await db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const sums = await db.stockMove.groupBy({
    by: ["materialId"],
    where: { materialId: { not: null } },
    _sum: { qty: true },
  });
  const map = new Map(sums.map((s) => [s.materialId, Number(s._sum.qty ?? 0)]));
  return materials.map((m) => ({
    ...m,
    balance: map.get(m.id) ?? 0,
    low: (map.get(m.id) ?? 0) < Number(m.minStock),
  }));
}

export type LastMove = { by: string; date: Date; qty: number };

/**
 * Har bir xomashyo / mahsulot bo'yicha oxirgi kirim: kim kiritdi, qachon, qancha.
 * Sotuvchi mijoz bilan gaplashganda sklad xodimining shu yozuviga tayanadi.
 */
export async function lastInboundMoves(): Promise<{ materials: Map<string, LastMove>; products: Map<string, LastMove> }> {
  const moves = await db.stockMove.findMany({
    where: { type: { in: ["RECEIPT", "PRODUCTION_OUTPUT", "ADJUSTMENT"] }, qty: { gt: 0 } },
    orderBy: { date: "desc" },
    take: 500,
    select: { materialId: true, productId: true, date: true, qty: true, createdBy: { select: { fullName: true } } },
  });
  const materials = new Map<string, LastMove>();
  const products = new Map<string, LastMove>();
  for (const m of moves) {
    const v = { by: m.createdBy.fullName, date: m.date, qty: Number(m.qty) };
    if (m.materialId && !materials.has(m.materialId)) materials.set(m.materialId, v);
    if (m.productId && !products.has(m.productId)) products.set(m.productId, v);
  }
  return { materials, products };
}

export type StockSnapshot = {
  materials: Array<{ id: string; name: string; unit: string; balance: number; minStock: number; low: boolean; last: LastMove | null }>;
  pieces: Array<{ id: string; code: string; name: string; unit: string; total: number; free: number; owned: number; last: LastMove | null }>;
  concrete: Array<{ id: string; code: string; name: string; balance: number; last: LastMove | null }>;
  asOf: Date;
};

/** Sotuv bo'limi uchun sklad surati: xomashyo, dona mahsulot (erkin/band), tayyor beton — va har birini kim kiritgani. */
export async function stockSnapshot(): Promise<StockSnapshot> {
  const [mats, pieces, concreteProducts, pSums, last] = await Promise.all([
    materialBalances(),
    ostatkaSummary(),
    db.product.findMany({ where: { isActive: true, unit: "m3" }, orderBy: { code: "asc" } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    lastInboundMoves(),
  ]);
  const pb = new Map(pSums.map((x) => [x.productId, Number(x._sum.qty ?? 0)]));
  return {
    materials: mats.map((m) => ({ id: m.id, name: m.name, unit: m.unit, balance: m.balance, minStock: Number(m.minStock), low: m.low, last: last.materials.get(m.id) ?? null })),
    pieces: pieces.map((p) => ({ id: p.id, code: p.code, name: p.name, unit: p.unit, total: p.total, free: p.free, owned: p.owned, last: last.products.get(p.id) ?? null })),
    concrete: concreteProducts.map((p) => ({ id: p.id, code: p.code, name: p.name, balance: pb.get(p.id) ?? 0, last: last.products.get(p.id) ?? null })),
    asOf: new Date(),
  };
}
