import { db } from "./db";
import type { Prisma } from "@/generated/prisma";
import { audit } from "./audit";
import { lockStock, STOCK_EPS } from "./stock-lock";
import { lockReceipt } from "./receipt-payables";
import { money, qty as fq } from "./format";

/**
 * Storno — xato kiritilgan kirim hujjati yoki zamesni bekor qilish. Yozuvlar o'chirilmaydi:
 * har bir sklad harakatiga teskari harakat (o'sha tur, o'sha sklad, o'sha tannarx, ishorasi teskari)
 * yoziladi, hujjat CANCELLED deb belgilanadi (kim, qachon, sabab) va audit jurnaliga tushadi.
 *
 * Teskari kirim (RECEIPT, qty < 0, o'sha unitCost) o'rtacha tannarxda asl kirimni aynan yo'qqa
 * chiqaradi: `avgUnitCosts` Σ(qty × narx) / Σqty ni RECEIPT harakatlarining ishorasi bilan hisoblaydi.
 *
 * Rad etiladi: qoldiq minusga tushsa (xomashyo allaqachon sarflangan / mahsulot jo'natilgan),
 * kirimga to'lov bog'langan bo'lsa (avval to'lovni storno qilish kerak), ta'minot zanjiridan kelgan kirim.
 * Ruxsat (DIRECTOR yoki direktor bergan amal) — chaqiruvchida.
 */
export type StornoResult = { ok: true; note: string } | { error: string };

class StornoError extends Error {}

type Move = { warehouseId: string; materialId: string | null; productId: string | null; qty: Prisma.Decimal | number; type: Prisma.StockMoveCreateManyInput["type"]; unitCost: Prisma.Decimal | number | null; brigadeId: string | null };

/**
 * Teskari harakatlardan keyin qoldiq (sklad × xomashyo/mahsulot) minusga tushmasligini tekshiradi.
 * Faqat kamayadigan qatorlar tekshiriladi (asl harakat musbat bo'lganlar).
 */
async function checkNoNegative(tx: Prisma.TransactionClient, moves: Move[], names: Map<string, string>) {
  const need = new Map<string, { warehouseId: string; materialId: string | null; productId: string | null; qty: number }>();
  for (const m of moves) {
    const q = Number(m.qty);
    if (q <= 0) continue; // teskarisi qoldiqni oshiradi
    const k = `${m.warehouseId}|${m.materialId ?? ""}|${m.productId ?? ""}`;
    const cur = need.get(k) ?? { warehouseId: m.warehouseId, materialId: m.materialId, productId: m.productId, qty: 0 };
    cur.qty += q;
    need.set(k, cur);
  }
  const short: string[] = [];
  for (const n of need.values()) {
    const b = await tx.stockMove.aggregate({
      where: { warehouseId: n.warehouseId, ...(n.materialId ? { materialId: n.materialId } : { productId: n.productId }) },
      _sum: { qty: true },
    });
    const bal = Number(b._sum.qty ?? 0);
    if (bal - n.qty < -STOCK_EPS) short.push(`${names.get(n.materialId ?? n.productId ?? "") ?? "?"}: qoldiq ${fq(Math.max(0, bal))}, qaytarish kerak ${fq(n.qty)}`);
  }
  if (short.length) throw new StornoError(`Storno qilinsa qoldiq minusga tushadi (allaqachon sarflangan yoki jo'natilgan): ${short.join("; ")}`);
}

async function reverseMoves(tx: Prisma.TransactionClient, moves: Move[], refType: string, refId: string, note: string, userId: string) {
  if (!moves.length) return;
  await tx.stockMove.createMany({
    data: moves.map((m) => ({
      type: m.type, warehouseId: m.warehouseId, materialId: m.materialId, productId: m.productId, brigadeId: m.brigadeId,
      qty: -Number(m.qty), unitCost: m.unitCost, refType, refId, note, createdById: userId,
    })),
  });
}

/** Kirim hujjatini storno qilish. */
export async function cancelReceipt(id: string, reason: string, userId: string): Promise<StornoResult> {
  const why = reason.trim();
  if (why.length < 3) return { error: "Storno sababini yozing" };
  return db.$transaction(async (tx): Promise<StornoResult> => {
    // Kirim qulfi (to'lash bilan navbat) va sklad qulfi (qoldiq tekshiruvi bilan navbat)
    await lockReceipt(tx, id);
    await lockStock(tx);
    const rec = await tx.goodsReceipt.findUnique({ where: { id }, include: { items: { include: { material: { select: { id: true, name: true } } } }, supply: { select: { docNo: true } } } });
    if (!rec) throw new StornoError("Kirim topilmadi");
    if (rec.cancelledAt) throw new StornoError("Kirim allaqachon storno qilingan");
    if (rec.supply) throw new StornoError(`Bu kirim ta'minot zayavkasidan (${rec.supply.docNo}) — puli zanjirda ajratilgan. Storno moliya bilan ta'minot bo'limi orqali hal qilinadi`);
    const paid = await tx.cashTransaction.aggregate({ where: { type: "EXPENSE", refType: "GoodsReceipt", refId: id }, _sum: { amount: true }, _count: { _all: true } });
    if (paid._count._all > 0) {
      throw new StornoError(`Kirimga ${paid._count._all} ta to'lov bog'langan (${money(Number(paid._sum.amount ?? 0))}). Avval to'lovni storno qiling (Kirim-Chiqim → chiqimni o'chirish), keyin kirimni`);
    }
    const moves = await tx.stockMove.findMany({ where: { refType: "GoodsReceipt", refId: id } });
    const names = new Map(rec.items.map((i) => [i.material.id, i.material.name]));
    await checkNoNegative(tx, moves, names);
    await reverseMoves(tx, moves, "GoodsReceipt", id, `Storno ${rec.docNo}: ${why}`, userId);
    const r = await tx.goodsReceipt.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelReason: why, cancelledById: userId } });
    if (r.count !== 1) throw new StornoError("Kirim shu payt boshqa joyda o'zgardi — sahifani yangilang");
    const total = rec.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0);
    await audit(tx, userId, "STATUS_CHANGE", "GoodsReceipt", id, { status: "ACTIVE" }, { status: "CANCELLED", reason: why, reversedMoves: moves.length, total });
    return { ok: true, note: `${rec.docNo} storno qilindi: ${moves.length} ta sklad harakati teskari yozildi` };
  }).catch((e: Error) => { if (e instanceof StornoError) return { error: e.message }; throw e; });
}

/** Zamesni storno qilish: xomashyo skladga qaytadi, tayyor mahsulot qoldiqdan chiqariladi. */
export async function cancelBatch(id: string, reason: string, userId: string): Promise<StornoResult> {
  const why = reason.trim();
  if (why.length < 3) return { error: "Storno sababini yozing" };
  return db.$transaction(async (tx): Promise<StornoResult> => {
    await lockStock(tx);
    const b = await tx.productionBatch.findUnique({ where: { id }, include: { product: { select: { id: true, name: true } } } });
    if (!b) throw new StornoError("Zames topilmadi");
    if (b.cancelledAt) throw new StornoError("Zames allaqachon storno qilingan");
    const moves = await tx.stockMove.findMany({ where: { refType: "ProductionBatch", refId: id }, include: { material: { select: { name: true } }, product: { select: { name: true } } } });
    const names = new Map<string, string>();
    for (const m of moves) {
      if (m.materialId && m.material) names.set(m.materialId, m.material.name);
      if (m.productId && m.product) names.set(m.productId, m.product.name);
    }
    await checkNoNegative(tx, moves, names);
    await reverseMoves(tx, moves, "ProductionBatch", id, `Storno ${b.batchNo}: ${why}`, userId);
    const r = await tx.productionBatch.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelReason: why, cancelledById: userId } });
    if (r.count !== 1) throw new StornoError("Zames shu payt boshqa joyda o'zgardi — sahifani yangilang");
    // Zayavka faqat shu zames tufayli "Ishlab chiqarilmoqda" bo'lgan bo'lsa — "Tasdiqlangan" ga qaytadi
    if (b.orderId) {
      const [batches, trips, progress] = await Promise.all([
        tx.productionBatch.count({ where: { orderId: b.orderId, cancelledAt: null } }),
        tx.trip.count({ where: { orderId: b.orderId, status: { not: "CANCELLED" } } }),
        tx.brigadeTask.count({ where: { orderId: b.orderId, doneQty: { gt: 0 } } }),
      ]);
      if (!batches && !trips && !progress) {
        const o = await tx.order.updateMany({ where: { id: b.orderId, status: "IN_PRODUCTION" }, data: { status: "CONFIRMED" } });
        if (o.count) await audit(tx, userId, "STATUS_CHANGE", "Order", b.orderId, { status: "IN_PRODUCTION" }, { status: "CONFIRMED", by: "batch-storno", batchId: id });
      }
    }
    await audit(tx, userId, "STATUS_CHANGE", "ProductionBatch", id, { status: "ACTIVE" }, { status: "CANCELLED", reason: why, reversedMoves: moves.length, qty: Number(b.qtyM3), product: b.product.name });
    return { ok: true, note: `${b.batchNo} storno qilindi: ${moves.length} ta sklad harakati teskari yozildi` };
  }).catch((e: Error) => { if (e instanceof StornoError) return { error: e.message }; throw e; });
}
