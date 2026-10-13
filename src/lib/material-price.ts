import type { Role } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { MAX_AMOUNT } from "./action";
import { avgUnitCosts } from "./stock";

/**
 * «Дона сўм» — xomashyo birlik narxi (Material.unitPrice). Snabjeniye (stock → "price" amali) belgilaydi; skladdan
 * chiqimlar (Расход, brigada, spisanie, zames) shu narx bilan `StockMove.unitCost` bo'lib yoziladi (`lib/stock-price.ts`).
 * Veb (Sklad → Остатки) va mobil bitta joydan o'tadi. Ruxsatni CHAQIRUVCHI tekshiradi (veb: `requireAction("stock",
 * "price")`, mobil: `can()`); `actor.role` — chaqiruvchi kontekstida qaror qabul qilish uchun, bu yerda ishlatilmaydi.
 * Har o'zgarish AuditLog'da (entity "Material", before/after `{ unitPrice }`).
 */

/** Foydalanuvchiga ko'rsatiladigan xato (ruscha — «Остатки» ekrani tili). Boshqa xatolar — kutilmagan. */
export class MaterialPriceError extends Error {}

export type MaterialPriceActor = { userId: string; role: Role };

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function setMaterialPrice(
  materialId: string,
  price: number | null,
  actor: MaterialPriceActor,
): Promise<{ changed: boolean; before: number | null; after: number | null }> {
  if (price != null && (!Number.isFinite(price) || price < 0 || price > MAX_AMOUNT)) {
    throw new MaterialPriceError("Неверная цена: нужно число от 0 до 1 000 000 000 000 000");
  }
  const after = price == null ? null : r2(price);
  return db.$transaction(async (tx) => {
    const m = await tx.material.findUnique({ where: { id: materialId }, select: { id: true, unitPrice: true } });
    if (!m) throw new MaterialPriceError("Сырьё не найдено — обновите страницу");
    const before = m.unitPrice == null ? null : Number(m.unitPrice);
    if (before === after) return { changed: false, before, after };
    // Shartli yozuv: oraliqda boshqa xodim narxni o'zgartirgan bo'lsa — eski qiymat ustiga yozilmaydi, audit to'g'ri qoladi
    const upd = await tx.material.updateMany({
      where: { id: m.id, unitPrice: m.unitPrice },
      data: { unitPrice: after, unitPriceAt: new Date(), unitPriceById: actor.userId },
    });
    if (upd.count === 0) throw new MaterialPriceError("Цену только что изменил другой пользователь — обновите страницу");
    await audit(tx, actor.userId, "UPDATE", "Material", m.id, { unitPrice: before }, { unitPrice: after });
    return { changed: true, before, after };
  });
}

/**
 * Narxi belgilanmagan faol xomashyolarga o'rtacha tannarxni (`avgUnitCosts`, 2 kasr) «Дона сўм» qilib qo'yadi.
 * Tannarxi yo'q (kirimi bo'lmagan) yoki 0 bo'lganlari o'tkazib yuboriladi. Har biri shartli (`unitPrice IS NULL`)
 * — oraliqda qo'lda qo'yilgan narx ustiga yozilmaydi; har biri auditda.
 */
export async function fillMissingPricesFromAvg(actor: MaterialPriceActor): Promise<{ filled: number; noCost: number }> {
  const mats = await db.material.findMany({ where: { isActive: true, unitPrice: null }, select: { id: true } });
  if (!mats.length) return { filled: 0, noCost: 0 };
  const avg = await avgUnitCosts(mats.map((m) => m.id));
  const plan = mats
    .map((m) => ({ id: m.id, price: r2(avg.get(m.id) ?? 0) }))
    .filter((x) => x.price > 0 && x.price <= MAX_AMOUNT);
  let filled = 0;
  if (plan.length) {
    await db.$transaction(async (tx) => {
      const now = new Date();
      for (const x of plan) {
        const u = await tx.material.updateMany({ where: { id: x.id, unitPrice: null }, data: { unitPrice: x.price, unitPriceAt: now, unitPriceById: actor.userId } });
        if (!u.count) continue;
        filled++;
        await audit(tx, actor.userId, "UPDATE", "Material", x.id, { unitPrice: null }, { unitPrice: x.price });
      }
    }, { timeout: 30_000 });
  }
  return { filled, noCost: mats.length - plan.length };
}
