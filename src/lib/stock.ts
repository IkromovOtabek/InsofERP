import { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { ostatkaSummary } from "./ostatka";
import { productionCapacity } from "./production-capacity";

/**
 * Xomashyoning o'rtacha tannarxi — MIQDORGA TORTILGAN: Σ(qty × unitCost) / Σ(qty).
 * (Oddiy `_avg(unitCost)` 1 kg lik qimmat partiyani 100 t lik arzon partiya bilan teng sanardi.)
 *
 * Manba — narxi bor kirim (RECEIPT) harakatlari. Kirimi umuman bo'lmagan xomashyo uchun (faqat
 * qo'lda kiritilgan narxli boshlang'ich qoldig'i bor) — narxli musbat ADJUSTMENT'lar bo'yicha.
 * Sklad, brigada qoldig'i qiymati, kirim/qo'lda kiritish formalari — hammasi shu bitta funksiyadan oladi.
 *
 * `client` — tranzaksiya ichida chaqirilsa `tx` beriladi.
 */
export async function avgUnitCosts(
  materialIds?: string[],
  client: Pick<Prisma.TransactionClient, "$queryRaw"> = db,
): Promise<Map<string, number>> {
  if (materialIds && !materialIds.length) return new Map();
  // Filtr oddiy parametr (`Prisma.sql` bo'lagi emas): dev'da HMR dan keyin globalThis'dagi eski client
  // yangi moduldagi bo'lakni tanimay `$1` qilib yuborardi — "syntax error at or near $1"
  const ids = materialIds ?? null;
  const rows = await client.$queryRaw<{ materialId: string; type: string; cost: Prisma.Decimal | number | null }[]>`
    SELECT "materialId", "type"::text AS "type", SUM("qty" * "unitCost") / NULLIF(SUM("qty"), 0) AS "cost"
    FROM "StockMove"
    WHERE "materialId" IS NOT NULL AND "unitCost" IS NOT NULL
      -- RECEIPT ishorasi bilan: storno (teskari kirim, qty < 0, o'sha narx) asl kirimni o'rtachadan aynan chiqaradi
      AND ("type" = 'RECEIPT' OR ("type" = 'ADJUSTMENT' AND "qty" > 0))
      AND (${ids}::text[] IS NULL OR "materialId" = ANY(${ids}::text[]))
    GROUP BY "materialId", "type"`;
  const receipt = new Map<string, number>();
  const opening = new Map<string, number>();
  for (const r of rows) {
    if (r.cost == null) continue;
    (r.type === "RECEIPT" ? receipt : opening).set(r.materialId, Number(r.cost));
  }
  for (const [id, c] of opening) if (!receipt.has(id)) receipt.set(id, c);
  return receipt;
}

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

export type MakeInfo = {
  canMake: number; // hozirgi xomashyo qoldig'i bilan qancha ishlab chiqarish mumkin
  limiting: { name: string; unit: string; balance: number; perUnit: number } | null; // avval tugaydigan xomashyo
} | null;

export type SnapshotProduct = {
  id: string; code: string; name: string; unit: string;
  total: number; // skladdagi jami qoldiq
  free: number; // zayavkalarga band qilinmagan qismi
  owned: number; // band qilingan
  make: MakeInfo; // retsept bo'yicha xomashyodan qancha chiqadi
  last: LastMove | null;
};

export type StockSnapshot = {
  materials: Array<{ id: string; name: string; unit: string; balance: number; minStock: number; low: boolean; last: LastMove | null }>;
  pieces: SnapshotProduct[]; // hovlida turadigan dona mahsulotlar (Sklad → Ishlab chiqarish imkoni)
  concrete: SnapshotProduct[]; // tayyor beton (m3) — zames qilingan, hali jo'natilmagan
  asOf: Date;
};

/**
 * Zayavka/sotuv bo'limi uchun korxonaning butun qoldig'i: Skladdagi xomashyo,
 * hovlidagi dona mahsulot (erkin/band), beton — har birini kim kiritgani va
 * xomashyo qoldig'i bilan yana qancha ishlab chiqarish mumkinligi bilan.
 */
export async function stockSnapshot(): Promise<StockSnapshot> {
  const [mats, pieces, concreteProducts, pSums, last, capacity] = await Promise.all([
    materialBalances(),
    ostatkaSummary(),
    db.product.findMany({ where: { isActive: true, unit: "m3" }, orderBy: { code: "asc" } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    lastInboundMoves(),
    productionCapacity(),
  ]);
  const pb = new Map(pSums.map((x) => [x.productId, Number(x._sum.qty ?? 0)]));
  const make = new Map<string, MakeInfo>(capacity.map((c) => [c.productId, { canMake: c.canMake, limiting: c.limiting }]));
  return {
    materials: mats.map((m) => ({ id: m.id, name: m.name, unit: m.unit, balance: m.balance, minStock: Number(m.minStock), low: m.low, last: last.materials.get(m.id) ?? null })),
    pieces: pieces.map((p) => ({ id: p.id, code: p.code, name: p.name, unit: p.unit, total: p.total, free: p.free, owned: p.owned, make: make.get(p.id) ?? null, last: last.products.get(p.id) ?? null })),
    concrete: concreteProducts.map((p) => {
      const total = pb.get(p.id) ?? 0;
      return { id: p.id, code: p.code, name: p.name, unit: p.unit, total, free: total, owned: 0, make: make.get(p.id) ?? null, last: last.products.get(p.id) ?? null };
    }),
    asOf: new Date(),
  };
}
