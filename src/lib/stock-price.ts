import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { avgUnitCosts } from "./stock";

/**
 * Skladdan chiqim narxi («Дона сўм») — har chiqim harakatiga (Расход/ISSUE, brigadaga berish, spisanie, zames,
 * inventarizatsiya kamomadi) shu narx `StockMove.unitCost` bo'lib YOZIB QO'YILADI (snapshot). Brigadadan qaytish —
 * brigada qo'lidagi o'rtacha narxda (`brigadeHoldCosts`), bu yerdagi narx faqat zaxira (fallback):
 * Snabjeniye narxni keyin o'zgartirsa ham o'tgan davr hisobotlari o'zgarmaydi.
 *
 * Qoida: `Material.unitPrice` (Snabjeniye belgilagan) → bo'lmasa o'rtacha tannarx (`avgUnitCosts`) → bo'lmasa yo'q.
 * Kirim (RECEIPT) va boshlang'ich qoldiq bu narxni ishlatmaydi — ular haqiqiy xarid narxi bilan yoziladi.
 */
export async function issuePrices(
  materialIds: string[],
  client: Pick<Prisma.TransactionClient, "$queryRaw" | "material"> = db,
): Promise<Map<string, number>> {
  const ids = [...new Set(materialIds)];
  if (!ids.length) return new Map();
  const [mats, avg] = await Promise.all([
    client.material.findMany({ where: { id: { in: ids } }, select: { id: true, unitPrice: true } }),
    avgUnitCosts(ids, client),
  ]);
  const out = new Map<string, number>();
  for (const m of mats) {
    const p = m.unitPrice != null ? Number(m.unitPrice) : avg.get(m.id);
    if (p != null && Number.isFinite(p)) out.set(m.id, p);
  }
  return out;
}

/** Bitta xomashyo uchun — `issuePrices` ning qisqasi. */
export async function issuePrice(materialId: string, client: Pick<Prisma.TransactionClient, "$queryRaw" | "material"> = db): Promise<number | null> {
  return (await issuePrices([materialId], client)).get(materialId) ?? null;
}
