import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";

/**
 * Brigada qo'lidagi xomashyo — sklad bilan bir prinsipda: qoldiq saqlanmaydi,
 * `BrigadeMove` jurnalining yig'indisi (berildi +, sarflandi/qaytdi −).
 *
 * Nima uchun kerak: Ishlab chiqarish bo'limi brigada tayinlayotganda "bu brigada
 * hozir qancha mahsulot chiqara oladi" degan savolga javob shu qoldiqdan chiqadi.
 */

export type BrigadeMaterial = { materialId: string; name: string; unit: string; qty: number; cost: number };

/** Xato matnlarida raqam chiroyli chiqsin (0,001 aniqlikda). */
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
export type MakeItem = { materialId: string; name: string; unit: string; perUnit: number; balance: number; enoughFor: number };
export type BrigadeMake = {
  productId: string; product: string; unit: string;
  canMake: number; // brigadadagi xomashyo bilan necha birlik chiqadi
  limiting: { name: string; unit: string; balance: number; perUnit: number } | null; // avval tugaydigan xomashyo
  items: MakeItem[]; // retseptdagi har bir xomashyo: normasi va brigadadagi qoldig'i (imkoniyat oynasi uchun)
};
export type BrigadeStock = {
  id: string; name: string; leader: string | null; isActive: boolean;
  materials: BrigadeMaterial[];
  makes: BrigadeMake[];
  value: number; // qo'lidagi xomashyo qiymati (o'rtacha tannarx bo'yicha)
  openQty: number; // ochiq topshiriqlardagi qoldiq (qancha ish bor)
};

/** O'rtacha tannarx — kirim va narxli tuzatishlar bo'yicha (Sklad sahifasidagi bilan bir xil qoida). */
async function avgCosts(): Promise<Map<string, number>> {
  const rows = await db.stockMove.groupBy({
    by: ["materialId"],
    where: { type: { in: ["RECEIPT", "ADJUSTMENT"] }, unitCost: { not: null }, materialId: { not: null } },
    _avg: { unitCost: true },
  });
  return new Map(rows.map((r) => [r.materialId!, Number(r._avg.unitCost ?? 0)]));
}

/**
 * Barcha brigadalar bo'yicha qoldiq va ishlab chiqarish imkoni.
 * `productId` berilsa — faqat shu mahsulot bo'yicha hisoblanadi (brigada tayinlash oynasi uchun yengil).
 */
export async function brigadeStocks(opts?: { productId?: string; includeInactive?: boolean }): Promise<BrigadeStock[]> {
  const [brigades, sums, materials, products, costs] = await Promise.all([
    db.brigade.findMany({
      where: opts?.includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { leader: { select: { fullName: true } }, tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } }, select: { qty: true, doneQty: true } } },
    }),
    db.brigadeMove.groupBy({ by: ["brigadeId", "materialId"], _sum: { qty: true } }),
    db.material.findMany({ select: { id: true, name: true, unit: true } }),
    db.product.findMany({
      where: { isActive: true, ...(opts?.productId ? { id: opts.productId } : {}) },
      orderBy: { code: "asc" },
      include: { recipes: { where: { isActive: true }, include: { items: { include: { material: { select: { name: true, unit: true } } } } } } },
    }),
    avgCosts(),
  ]);
  const meta = new Map(materials.map((m) => [m.id, m]));
  const byBrigade = new Map<string, Map<string, number>>();
  for (const s of sums) {
    const q = Number(s._sum.qty ?? 0);
    if (Math.abs(q) < 0.0005) continue;
    const m = byBrigade.get(s.brigadeId) ?? new Map<string, number>();
    m.set(s.materialId, q);
    byBrigade.set(s.brigadeId, m);
  }
  const withRecipe = products.filter((p) => p.recipes[0]?.items.length);

  return brigades.map((b) => {
    const bal = byBrigade.get(b.id) ?? new Map<string, number>();
    const materialsOut: BrigadeMaterial[] = [...bal.entries()]
      .map(([id, q]) => ({ materialId: id, name: meta.get(id)?.name ?? "?", unit: meta.get(id)?.unit ?? "", qty: q, cost: q * (costs.get(id) ?? 0) }))
      .sort((x, y) => x.name.localeCompare(y.name));
    const makes: BrigadeMake[] = withRecipe.map((p) => {
      const items: MakeItem[] = p.recipes[0].items.map((i) => {
        const perUnit = Number(i.qtyPerM3), balance = bal.get(i.materialId) ?? 0;
        return { materialId: i.materialId, name: i.material.name, unit: i.material.unit, perUnit, balance, enoughFor: perUnit > 0 ? balance / perUnit : Infinity };
      });
      const lim = items.reduce<(typeof items)[number] | null>((m, x) => (m == null || x.enoughFor < m.enoughFor ? x : m), null);
      const canMake = Math.max(0, Math.floor((lim?.enoughFor ?? 0) * 100) / 100);
      return {
        productId: p.id, product: p.name, unit: p.unit, canMake,
        limiting: lim && Number.isFinite(lim.enoughFor) ? { name: lim.name, unit: lim.unit, balance: lim.balance, perUnit: lim.perUnit } : null,
        items,
      };
    });
    return {
      id: b.id, name: b.name, leader: b.leader?.fullName ?? null, isActive: b.isActive,
      materials: materialsOut, makes,
      value: materialsOut.reduce((s, m) => s + m.cost, 0),
      openQty: b.tasks.reduce((s, t) => s + Math.max(0, Number(t.qty) - Number(t.doneQty)), 0),
    };
  });
}

/** Bitta mahsulot bo'yicha: qaysi brigada qanchasini chiqara oladi (brigada tayinlash oynasi). */
export async function brigadeCapacityFor(productId: string) {
  const list = await brigadeStocks({ productId });
  return new Map(list.map((b) => [b.id, b.makes[0] ?? null]));
}

// ───────────────────────── Taqsimlash ─────────────────────────

export type IssueRow = { materialId: string; qty: number };
export type IssueResult = { ok?: boolean; error?: string; note?: string };

/**
 * Skladdan brigadaga berish. Ikki jurnalga yoziladi:
 * sklad qoldig'i kamayadi (StockMove BRIGADE_ISSUE, −), brigada qoldig'i oshadi (BrigadeMove ISSUE, +).
 * Skladda yetmasa — berilmaydi (qaysi xomashyo qancha yetmagani aytiladi).
 */
export async function issueToBrigade(
  input: { brigadeId: string; warehouseId: string; rows: IssueRow[]; note?: string | null },
  userId: string,
): Promise<IssueResult> {
  const rows = input.rows.filter((r) => r.materialId && r.qty > 0);
  if (!rows.length) return { error: "Kamida bitta xomashyo va miqdor kiriting" };
  const [brigade, wh] = await Promise.all([
    db.brigade.findUnique({ where: { id: input.brigadeId } }),
    db.warehouse.findUnique({ where: { id: input.warehouseId } }),
  ]);
  if (!brigade || !brigade.isActive) return { error: "Brigada topilmadi yoki nofaol" };
  if (!wh) return { error: "Sklad tanlanmagan" };

  const ids = [...new Set(rows.map((r) => r.materialId))];
  const [sums, materials, costs] = await Promise.all([
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { in: ids } }, _sum: { qty: true } }),
    db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } }),
    avgCosts(),
  ]);
  const bal = new Map(sums.map((s) => [s.materialId!, Number(s._sum.qty ?? 0)]));
  const meta = new Map(materials.map((m) => [m.id, m]));
  // Bir xomashyo bir necha qatorda bo'lsa yig'indisi tekshiriladi — 2 t qoldiqdan 4 t berilmaydi
  const wanted = new Map<string, number>();
  for (const r of rows) wanted.set(r.materialId, (wanted.get(r.materialId) ?? 0) + r.qty);
  const short = [...wanted.entries()]
    .filter(([id, q]) => (bal.get(id) ?? 0) < q - 0.0005)
    .map(([id, q]) => `${meta.get(id)?.name ?? "?"} (skladda ${fmt(bal.get(id) ?? 0)}, so'ralgan ${fmt(q)} ${meta.get(id)?.unit ?? ""})`);
  if (short.length) return { error: `Skladda yetmaydi: ${short.join(", ")}` };

  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const cost = costs.get(r.materialId) ?? null;
      const move = await tx.stockMove.create({
        data: {
          type: "BRIGADE_ISSUE", warehouseId: wh.id, materialId: r.materialId, brigadeId: brigade.id,
          qty: -r.qty, unitCost: cost, refType: "Brigade", refId: brigade.id,
          note: `${brigade.name} brigadasiga berildi${input.note ? ` · ${input.note}` : ""}`, createdById: userId,
        },
      });
      await tx.brigadeMove.create({
        data: {
          type: "ISSUE", brigadeId: brigade.id, materialId: r.materialId, qty: r.qty, unitCost: cost,
          refType: "StockMove", refId: move.id, note: input.note ?? null, createdById: userId,
        },
      });
    }
    await audit(tx, userId, "CREATE", "BrigadeMove", brigade.id, undefined, { brigade: brigade.name, rows, warehouse: wh.name });
  });
  return { ok: true, note: `${brigade.name}: ${rows.length} ta xomashyo berildi` };
}

/** Brigadadan skladga qaytarish — ishlatilmagan xomashyo. */
export async function returnFromBrigade(
  input: { brigadeId: string; warehouseId: string; rows: IssueRow[]; note?: string | null },
  userId: string,
): Promise<IssueResult> {
  const rows = input.rows.filter((r) => r.materialId && r.qty > 0);
  if (!rows.length) return { error: "Kamida bitta xomashyo va miqdor kiriting" };
  const brigade = await db.brigade.findUnique({ where: { id: input.brigadeId } });
  if (!brigade) return { error: "Brigada topilmadi" };
  const ids = [...new Set(rows.map((r) => r.materialId))];
  const [sums, materials] = await Promise.all([
    db.brigadeMove.groupBy({ by: ["materialId"], where: { brigadeId: brigade.id, materialId: { in: ids } }, _sum: { qty: true } }),
    db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  const bal = new Map(sums.map((s) => [s.materialId, Number(s._sum.qty ?? 0)]));
  const meta = new Map(materials.map((m) => [m.id, m.name]));
  const wanted = new Map<string, number>();
  for (const r of rows) wanted.set(r.materialId, (wanted.get(r.materialId) ?? 0) + r.qty);
  const short = [...wanted.entries()]
    .filter(([id, q]) => (bal.get(id) ?? 0) < q - 0.0005)
    .map(([id, q]) => `${meta.get(id) ?? "?"} (brigadada ${fmt(bal.get(id) ?? 0)}, so'ralgan ${fmt(q)})`);
  if (short.length) return { error: `Brigadada yo'q: ${short.join(", ")}` };

  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const move = await tx.stockMove.create({
        data: {
          type: "BRIGADE_RETURN", warehouseId: input.warehouseId, materialId: r.materialId, brigadeId: brigade.id,
          qty: r.qty, refType: "Brigade", refId: brigade.id,
          note: `${brigade.name} brigadasidan qaytdi${input.note ? ` · ${input.note}` : ""}`, createdById: userId,
        },
      });
      await tx.brigadeMove.create({
        data: { type: "RETURN", brigadeId: brigade.id, materialId: r.materialId, qty: -r.qty, refType: "StockMove", refId: move.id, note: input.note ?? null, createdById: userId },
      });
    }
    await audit(tx, userId, "CREATE", "BrigadeMove", brigade.id, undefined, { brigade: brigade.name, returned: rows });
  });
  return { ok: true, note: `${brigade.name}: ${rows.length} ta xomashyo qaytarildi` };
}

/**
 * Topshiriq bajarilganda brigada qo'lidagi xomashyo retsept normasi bo'yicha kamayadi.
 * `lib/tasks.ts` shu funksiyani topshiriq tranzaksiyasi ichida chaqiradi — veb ham, mobil ilova ham.
 * Retsepti yo'q mahsulotda hech narsa yozilmaydi.
 */
export async function consumeForTask(
  tx: Prisma.TransactionClient,
  task: { id: string; brigadeId: string; orderItemId: string },
  doneQty: number,
  userId: string,
): Promise<{ rows: number; deficit: string[] }> {
  const item = await tx.orderItem.findUnique({ where: { id: task.orderItemId }, select: { productId: true } });
  if (!item) return { rows: 0, deficit: [] };
  const recipe = await tx.recipe.findFirst({
    where: { productId: item.productId, isActive: true },
    orderBy: { version: "desc" },
    include: { items: { include: { material: { select: { name: true, unit: true } } } } },
  });
  if (!recipe?.items.length) return { rows: 0, deficit: [] };

  const sums = await tx.brigadeMove.groupBy({
    by: ["materialId"],
    where: { brigadeId: task.brigadeId, materialId: { in: recipe.items.map((i) => i.materialId) } },
    _sum: { qty: true },
  });
  const bal = new Map(sums.map((s) => [s.materialId, Number(s._sum.qty ?? 0)]));
  const deficit: string[] = [];
  for (const i of recipe.items) {
    const need = Number(i.qtyPerM3) * doneQty;
    if (need <= 0) continue;
    const have = bal.get(i.materialId) ?? 0;
    if (have < need - 0.0005) deficit.push(`${i.material.name}: ${Math.round((need - have) * 1000) / 1000} ${i.material.unit}`);
    await tx.brigadeMove.create({
      data: {
        type: "CONSUME", brigadeId: task.brigadeId, materialId: i.materialId, qty: -need,
        refType: "BrigadeTask", refId: task.id, note: `Bajarilgan ${doneQty} × norma ${Number(i.qtyPerM3)}`, createdById: userId,
      },
    });
  }
  return { rows: recipe.items.length, deficit };
}

/**
 * Ta'minot bo'yicha kelgan, lekin hali birorta brigadaga berilmagan mahsulotlar.
 * Kelgan sanadan keyin shu xomashyo bo'yicha BRIGADE_ISSUE bo'lmagan bo'lsa — "berilmagan".
 * Sklad va Brigadalar bo'limida "nechta mahsulot taqsimlanmagan" belgisi shundan chiqadi.
 */
export async function undistributedMaterials(sinceDays = 30): Promise<{ count: number; names: string[] }> {
  const since = new Date(Date.now() - sinceDays * 864e5);
  const received = await db.supplyRequest.findMany({
    where: { status: "RECEIVED", updatedAt: { gte: since } },
    select: { updatedAt: true, items: { select: { materialId: true, name: true, factQty: true, qty: true } } },
  });
  // Har xomashyo bo'yicha eng oxirgi kelish sanasi
  const arrived = new Map<string, { name: string; at: Date }>();
  for (const r of received) {
    for (const i of r.items) {
      if (!i.materialId || Number(i.factQty ?? i.qty) <= 0) continue;
      const cur = arrived.get(i.materialId);
      if (!cur || cur.at < r.updatedAt) arrived.set(i.materialId, { name: i.name, at: r.updatedAt });
    }
  }
  if (arrived.size === 0) return { count: 0, names: [] };
  const issues = await db.stockMove.findMany({
    where: { type: "BRIGADE_ISSUE", materialId: { in: [...arrived.keys()] }, date: { gte: since } },
    select: { materialId: true, date: true },
  });
  const lastIssue = new Map<string, Date>();
  for (const m of issues) {
    const cur = lastIssue.get(m.materialId!);
    if (!cur || cur < m.date) lastIssue.set(m.materialId!, m.date);
  }
  const names: string[] = [];
  for (const [id, v] of arrived) {
    const gave = lastIssue.get(id);
    if (!gave || gave < v.at) names.push(v.name);
  }
  return { count: names.length, names };
}
