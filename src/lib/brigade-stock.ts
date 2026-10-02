import { lockStock, STOCK_EPS } from "@/lib/stock-lock";
import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { avgUnitCosts } from "./stock";
import { notifyAfter, notifyRoles } from "./notify";

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

/** O'rtacha tannarx — miqdorga tortilgan (`lib/stock.ts` dagi umumiy qoida, Sklad sahifasidagi bilan bir xil). */
const avgCosts = (ids?: string[]) => avgUnitCosts(ids);

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
  // Brigada qo'lida faqat xomashyo saqlanadi (BrigadeMove hali mahsulotni qo'llamaydi) — retseptida
  // boshqa mahsulot (masalan FBS blok) bo'lgan mahsulotlar bu ro'yxatda "chiqara oladi" deb ko'rsatilmaydi
  const withRecipe = products.filter((p) => {
    const items = p.recipes[0]?.items ?? [];
    return items.length > 0 && items.every((i) => i.materialId != null);
  });

  return brigades.map((b) => {
    const bal = byBrigade.get(b.id) ?? new Map<string, number>();
    const materialsOut: BrigadeMaterial[] = [...bal.entries()]
      .map(([id, q]) => ({ materialId: id, name: meta.get(id)?.name ?? "?", unit: meta.get(id)?.unit ?? "", qty: q, cost: q * (costs.get(id) ?? 0) }))
      .sort((x, y) => x.name.localeCompare(y.name));
    const makes: BrigadeMake[] = withRecipe.map((p) => {
      const items: MakeItem[] = p.recipes[0].items.map((i) => {
        const perUnit = Number(i.qtyPerM3), balance = bal.get(i.materialId!) ?? 0;
        return { materialId: i.materialId!, name: i.material!.name, unit: i.material!.unit, perUnit, balance, enoughFor: perUnit > 0 ? balance / perUnit : Infinity };
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
  const [materials, costs] = await Promise.all([
    db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } }),
    avgCosts(ids),
  ]);
  const meta = new Map(materials.map((m) => [m.id, m]));
  // Bir xomashyo bir necha qatorda bo'lsa yig'indisi tekshiriladi — 2 t qoldiqdan 4 t berilmaydi
  const wanted = new Map<string, number>();
  for (const r of rows) wanted.set(r.materialId, (wanted.get(r.materialId) ?? 0) + r.qty);

  const res = await db.$transaction(async (tx) => {
    // Qoldiq qulf ostida va AYNAN tanlangan sklad bo'yicha tekshiriladi (chiqim ham shu skladdan)
    await lockStock(tx);
    const sums = await tx.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: wh.id, materialId: { in: ids } }, _sum: { qty: true } });
    const bal = new Map(sums.map((s) => [s.materialId!, Number(s._sum.qty ?? 0)]));
    const short = [...wanted.entries()]
      .filter(([id, q]) => (bal.get(id) ?? 0) < q - STOCK_EPS)
      .map(([id, q]) => `${meta.get(id)?.name ?? "?"} (${wh.name}da ${fmt(bal.get(id) ?? 0)}, so'ralgan ${fmt(q)} ${meta.get(id)?.unit ?? ""})`);
    if (short.length) return { error: `Skladda yetmaydi: ${short.join(", ")}` };
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
    return null;
  });
  if (res) return res;
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
  const wh = await db.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true } });
  if (!wh) return { error: "Sklad topilmadi" };
  const ids = [...new Set(rows.map((r) => r.materialId))];
  const materials = await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const meta = new Map(materials.map((m) => [m.id, m.name]));
  const wanted = new Map<string, number>();
  for (const r of rows) wanted.set(r.materialId, (wanted.get(r.materialId) ?? 0) + r.qty);

  const res = await db.$transaction(async (tx) => {
    // Brigada qoldig'i qulf ostida tekshiriladi: ikki qaytarish bir vaqtda kelsa, brigadada yo'q
    // xomashyo skladga "qaytib" qolmasin
    await lockStock(tx);
    const sums = await tx.brigadeMove.groupBy({ by: ["materialId"], where: { brigadeId: brigade.id, materialId: { in: ids } }, _sum: { qty: true } });
    const bal = new Map(sums.map((s) => [s.materialId, Number(s._sum.qty ?? 0)]));
    const short = [...wanted.entries()]
      .filter(([id, q]) => (bal.get(id) ?? 0) < q - STOCK_EPS)
      .map(([id, q]) => `${meta.get(id) ?? "?"} (brigadada ${fmt(bal.get(id) ?? 0)}, so'ralgan ${fmt(q)})`);
    if (short.length) return { error: `Brigadada yo'q: ${short.join(", ")}` };
    for (const r of rows) {
      const move = await tx.stockMove.create({
        data: {
          type: "BRIGADE_RETURN", warehouseId: wh.id, materialId: r.materialId, brigadeId: brigade.id,
          qty: r.qty, refType: "Brigade", refId: brigade.id,
          note: `${brigade.name} brigadasidan qaytdi${input.note ? ` · ${input.note}` : ""}`, createdById: userId,
        },
      });
      await tx.brigadeMove.create({
        data: { type: "RETURN", brigadeId: brigade.id, materialId: r.materialId, qty: -r.qty, refType: "StockMove", refId: move.id, note: input.note ?? null, createdById: userId },
      });
    }
    await audit(tx, userId, "CREATE", "BrigadeMove", brigade.id, undefined, { brigade: brigade.name, returned: rows });
    return null;
  });
  if (res) return res;
  return { ok: true, note: `${brigade.name}: ${rows.length} ta xomashyo qaytarildi` };
}

/**
 * Topshiriq bajarilganda brigada qo'lidagi xomashyo retsept normasi bo'yicha kamayadi.
 * `lib/tasks.ts` shu funksiyani topshiriq tranzaksiyasi ichida chaqiradi — veb ham, mobil ilova ham.
 * Retsepti yo'q mahsulotda hech narsa yozilmaydi.
 *
 * Brigadada yetmasa (brigada qoldig'i minusga tushmasin):
 *  1) yetmagan qism skladdan AVTOMATIK beriladi (StockMove BRIGADE_ISSUE −, BrigadeMove ISSUE +),
 *     qoldig'i ko'p skladdan boshlab, `lockStock` ostida;
 *  2) skladda ham yetmasa — progress baribir yoziladi (ish bajarilgan), lekin natijada aniq ogohlantirish
 *     (`deficit`) qaytadi va Sklad + Ishlab chiqarish bo'limiga xabar ketadi.
 * `issued` — skladdan avtomatik berilganlar (chaqiruvchi xabarga qo'shishi mumkin).
 */
export async function consumeForTask(
  tx: Prisma.TransactionClient,
  task: { id: string; brigadeId: string; orderItemId: string },
  doneQty: number,
  userId: string,
): Promise<{ rows: number; deficit: string[]; issued: string[] }> {
  const item = await tx.orderItem.findUnique({ where: { id: task.orderItemId }, select: { productId: true } });
  if (!item) return { rows: 0, deficit: [], issued: [] };
  const recipe = await tx.recipe.findFirst({
    where: { productId: item.productId, isActive: true },
    orderBy: { version: "desc" },
    include: { items: { include: { material: { select: { name: true, unit: true } } } } },
  });
  if (!recipe?.items.length) return { rows: 0, deficit: [], issued: [] };
  // Brigada qo'lida faqat xomashyo saqlanadi — retseptdagi mahsulot-ingredient (masalan FBS blok)
  // bu yerda hisobga olinmaydi (BrigadeMove hali mahsulotni qo'llamaydi, sklad → zames orqali hisoblanadi)
  const items = recipe.items.filter((i) => i.materialId);
  if (!items.length) return { rows: 0, deficit: [], issued: [] };
  const ids = items.map((i) => i.materialId!);

  // Brigada va sklad qoldig'i qulf ostida o'qiladi — parallel berish/sarf bir qoldiqni ikki marta ishlatmasin
  await lockStock(tx);
  const sums = await tx.brigadeMove.groupBy({
    by: ["materialId"],
    where: { brigadeId: task.brigadeId, materialId: { in: ids } },
    _sum: { qty: true },
  });
  const bal = new Map(sums.map((s) => [s.materialId, Number(s._sum.qty ?? 0)]));
  // Yetmagan qism: material → miqdor
  const needBy = new Map<string, number>();
  for (const i of items) {
    const need = Number(i.qtyPerM3) * doneQty;
    if (need > 0) needBy.set(i.materialId!, (needBy.get(i.materialId!) ?? 0) + need);
  }
  const lack = new Map<string, number>();
  for (const [id, need] of needBy) {
    const have = Math.max(0, bal.get(id) ?? 0);
    if (have < need - STOCK_EPS) lack.set(id, need - have);
  }

  const issued: string[] = [];
  const deficit: string[] = [];
  if (lack.size) {
    const brigade = await tx.brigade.findUnique({ where: { id: task.brigadeId }, select: { name: true } });
    const [whSums, warehouses, costs] = await Promise.all([
      tx.stockMove.groupBy({ by: ["warehouseId", "materialId"], where: { materialId: { in: [...lack.keys()] } }, _sum: { qty: true } }),
      tx.warehouse.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      avgUnitCosts([...lack.keys()], tx),
    ]);
    const active = new Set(warehouses.map((w) => w.id));
    for (const [materialId, missing] of lack) {
      const meta = items.find((i) => i.materialId === materialId)!.material!;
      // Qoldig'i ko'p skladdan boshlab olinadi (bir nechta sklad bo'lsa — bo'lib)
      const sources = whSums
        .filter((w) => w.materialId === materialId && active.has(w.warehouseId) && Number(w._sum.qty ?? 0) > STOCK_EPS)
        .map((w) => ({ warehouseId: w.warehouseId, qty: Number(w._sum.qty ?? 0) }))
        .sort((x, y) => y.qty - x.qty);
      let left = missing;
      for (const src of sources) {
        if (left <= STOCK_EPS) break;
        const take = Math.min(left, src.qty);
        const cost = costs.get(materialId) ?? null;
        const move = await tx.stockMove.create({
          data: {
            type: "BRIGADE_ISSUE", warehouseId: src.warehouseId, materialId, brigadeId: task.brigadeId,
            qty: -take, unitCost: cost, refType: "BrigadeTask", refId: task.id,
            note: `${brigade?.name ?? "Brigada"}ga avtomatik berildi — topshiriq uchun yetmadi`, createdById: userId,
          },
        });
        await tx.brigadeMove.create({
          data: {
            type: "ISSUE", brigadeId: task.brigadeId, materialId, qty: take, unitCost: cost,
            refType: "StockMove", refId: move.id, note: "Avtomatik: topshiriq sarfi uchun skladdan", createdById: userId,
          },
        });
        left -= take;
      }
      const given = missing - Math.max(0, left);
      if (given > STOCK_EPS) issued.push(`${meta.name}: ${fmt(given)} ${meta.unit}`);
      if (left > STOCK_EPS) deficit.push(`${meta.name}: ${fmt(left)} ${meta.unit}`);
    }
    if (issued.length || deficit.length) {
      await audit(tx, userId, "CREATE", "BrigadeMove", task.brigadeId, undefined, { autoIssue: issued, deficit, taskId: task.id });
    }
  }

  for (const i of items) {
    const need = Number(i.qtyPerM3) * doneQty;
    if (need <= 0) continue;
    await tx.brigadeMove.create({
      data: {
        type: "CONSUME", brigadeId: task.brigadeId, materialId: i.materialId!, qty: -need,
        refType: "BrigadeTask", refId: task.id, note: `Bajarilgan ${doneQty} × norma ${Number(i.qtyPerM3)}`, createdById: userId,
      },
    });
  }

  if (deficit.length) {
    // Skladda ham yetmadi — brigada qoldig'i minusga tushdi: sklad to'ldirsin, ishlab chiqarish bilsin
    notifyAfter(() => notifyRoles(["WAREHOUSE", "PRODUCTION"], {
      type: "BRIGADE_DEFICIT",
      title: "Brigadada xomashyo yetmadi — skladda ham yo'q",
      body: `${deficit.join("; ")} — brigada qoldig'i minusda, ta'minot kerak`,
      link: { key: "tasks", id: task.id },
    }, { except: userId }));
  }
  return { rows: items.length, deficit, issued };
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
