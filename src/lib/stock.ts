import { db } from "./db";

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
