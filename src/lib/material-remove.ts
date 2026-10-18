import { db } from "./db";
import { audit } from "./audit";
import { lockStock, STOCK_EPS } from "./stock-lock";
import { fmtNum } from "./format";
import type { Role } from "@/generated/prisma";

export type MaterialActor = { userId: string; role: Role };
export type RemoveOutcome =
  | { kind: "deleted"; name: string; opening: number }
  | { kind: "archived"; name: string; why: string }
  | { kind: "kept"; name: string; why: string }
  | { kind: "missing" };

/**
 * Bitta xomashyoni o'chirish qoidasi (bitta tugma ham, belgilanganlarni birdan o'chirish ham shu yerdan):
 *  1. Hech qayerda ishlatilmagan — butunlay o'chiriladi.
 *  2. Faqat «Sklad → Xomashyo qo'shish» dagi boshlang'ich qoldig'i bor (StockMove ADJUSTMENT, refType "StockIn"),
 *     boshqa hech bir hujjatda (retsept, kirim, ta'minot, brigada, sarf/zames va boshqa sklad harakati) yo'q —
 *     xato kiritilgan xomashyo: boshlang'ich qoldig'i bilan birga butunlay o'chiriladi (AuditLog'da to'liq nusxasi).
 *     Shartlar: o'chiruvchi — direktor yoki o'sha qoldiqni kiritgan xodimning o'zi (sklad qoldig'i hujjatsiz
 *     yo'qolmasin); qo'shish summasi Kirim-Chiqimga chiqim bo'lib yozilmagan (pul yozuvi buzilmasin).
 *  3. Hujjatlarda ishlatilgan — o'chirilmaydi, arxivga olinadi (`isActive = false`): ro'yxatlarda ko'rinmaydi,
 *     eski hujjatlar buzilmaydi. Lekin skladda qoldig'i bor xomashyo arxivga ham olinmaydi: aks holda bor tovar
 *     qoldiq jadvali va dashborddan jimgina yo'qolardi («Hammasini belgilash» bilan — butun sklad). Avval
 *     Inventarizatsiya yoki Hisobdan chiqarish bilan qoldiqni 0 qilish kerak.
 * Sklad qulfi va xomashyo qatori qulfi ostida: shu payt sarf, import, retsept yoki ta'minot qatori qo'shilib
 * qolmasin (StockMove/RecipeItem/SupplyRequestItem FK'si ON DELETE SET NULL — poygada jimgina bo'shab qolardi).
 */
export async function removeMaterial(id: string, actor: MaterialActor): Promise<RemoveOutcome> {
  return db.$transaction(async (tx) => {
    await lockStock(tx);
    // FOR UPDATE: parallel FK yozuvi (import, retsept, ta'minot) shu tranzaksiya tugaguncha kutadi
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Material" WHERE id = ${id} FOR UPDATE`;
    if (!locked.length) return { kind: "missing" as const };
    const m = await tx.material.findUnique({ where: { id } });
    if (!m) return { kind: "missing" as const };
    const recipeItems = await tx.recipeItem.count({ where: { materialId: id } });
    const receipts = await tx.goodsReceiptItem.count({ where: { materialId: id } });
    const supply = await tx.supplyRequestItem.count({ where: { materialId: id } });
    const brigade = await tx.brigadeMove.count({ where: { materialId: id } });
    const moves = await tx.stockMove.findMany({ where: { materialId: id }, select: { id: true, type: true, refType: true, refId: true, qty: true, unitCost: true, warehouseId: true, createdById: true, date: true } });
    const opening = moves.filter((x) => x.refType === "StockIn" && x.type === "ADJUSTMENT");
    const otherMoves = moves.length - opening.length;
    const used = recipeItems + receipts + supply + brigade + otherMoves;

    const balance = moves.reduce((a, x) => a + Number(x.qty), 0);
    const archive = async (why: string) => {
      if (Math.abs(balance) > STOCK_EPS) {
        return { kind: "kept" as const, name: m.name, why: `${why}; skladda qoldig'i bor (${fmtNum(balance, 3)} ${m.unit}) — avval Inventarizatsiya yoki Hisobdan chiqarish bilan qoldiqni 0 qiling` };
      }
      if (!m.isActive) return { kind: "kept" as const, name: m.name, why: `${why}; allaqachon arxivda` };
      const after = await tx.material.update({ where: { id }, data: { isActive: false } });
      await audit(tx, actor.userId, "UPDATE", "Material", id, m, { ...after, reason: `ro'yxatdan olib tashlandi (arxiv): ${why}` });
      return { kind: "archived" as const, name: m.name, why };
    };

    if (used > 0) {
      const parts = [
        recipeItems && `retseptda ${recipeItems}`, receipts && `kirimda ${receipts}`, supply && `ta'minotda ${supply}`,
        brigade && `brigada harakatida ${brigade}`, otherMoves && `sklad harakatida ${otherMoves}`,
      ].filter(Boolean);
      return archive(`hujjatlarda ishlatilgan (${parts.join(", ")})`);
    }
    if (opening.length) {
      if (actor.role !== "DIRECTOR" && opening.some((x) => x.createdById !== actor.userId)) {
        return archive("boshlang'ich qoldig'ini boshqa xodim kiritgan — qoldiq bilan butunlay o'chirishni direktor yoki kiritgan xodim qiladi");
      }
      const batches = [...new Set(opening.map((x) => x.refId).filter((x): x is string => !!x))];
      // Bekor qilingan yozuv ham sanaladi (ataylab): u o'chirilmaydi, unga ishora qolishi kerak — material arxivga olinadi
      const paid = batches.length ? await tx.cashTransaction.count({ where: { refType: "StockIn", refId: { in: batches } } }) : 0;
      if (paid) return archive("qo'shish summasi Kirim-Chiqimga chiqim bo'lib yozilgan — pul yozuvi buzilmasin");
      await tx.stockMove.deleteMany({ where: { id: { in: opening.map((x) => x.id) } } });
    }
    await tx.material.delete({ where: { id } });
    await audit(tx, actor.userId, "DELETE", "Material", id, { ...m, openingMoves: opening }, undefined);
    return { kind: "deleted" as const, name: m.name, opening: opening.length };
  });
}
