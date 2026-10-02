"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { qty as fq } from "@/lib/format";
import { ingredientOf, balanceOf } from "@/lib/recipe";
import { lockStock, STOCK_EPS } from "@/lib/stock-lock";

class ShortError extends Error {}

const schema = z.object({
  orderId: zOpt,
  productId: zStr("Marka tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  qtyM3: z.coerce.number({ message: "Miqdorni raqam bilan yozing" }).positive("miqdor 0 dan katta bo'lsin").max(10_000, "miqdor juda katta"),
  shift: z.coerce.number({ message: "Smenani tanlang" }).int().min(1, "Smenani tanlang").max(3, "Smenani tanlang"),
  note: zOpt,
});

/**
 * Zames qaydi. Bitta tranzaksiyada:
 *  1) faol retsept bo'yicha har bir ingredient (xomashyo yoki boshqa mahsulot) uchun PRODUCTION_CONSUME (−)
 *  2) tayyor mahsulot uchun PRODUCTION_OUTPUT (+)
 *  3) zayavka → IN_PRODUCTION
 * Xomashyo yoki mahsulot yetmasa — xato, hech narsa yozilmaydi.
 */
export async function createBatch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  const recipe = await db.recipe.findFirst({ where: { productId: d.productId, isActive: true }, include: { items: { include: { material: true, product: true } } } });
  if (!recipe) return { error: "Bu marka uchun faol retsept yo'q. Avval retsept kiriting." };

  if (d.orderId) {
    const o = await db.order.findUnique({ where: { id: d.orderId }, select: { status: true, items: { select: { productId: true, product: { select: { unit: true } } } } } });
    if (!o || !["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { error: "Zayavka tasdiqlanmagan yoki yopilgan" };
    // Zames zayavkadagi mahsulotga yoziladi — boshqa marka zayavka hisobiga o'tib ketmasin
    const line = o.items.find((i) => i.productId === d.productId);
    if (!line) return { error: "Bu marka tanlangan zayavkada yo'q" };
    // Zayavka hisobiga zames faqat beton (m³) qatoriga: dona mahsulotni brigada topshirig'i chiqaradi
    // (aks holda bir mahsulot zames + brigada qaydi bilan ikki marta kirim bo'ladi)
    if (line.product.unit !== "m3") return { error: "Zayavkadagi dona mahsulot brigada topshirig'i orqali chiqariladi — zayavka hisobiga zames faqat beton (m³) uchun" };
  }
  const wh = await db.warehouse.findFirst({ where: { id: d.warehouseId, isActive: true }, select: { id: true } });
  if (!wh) return { error: "Sklad topilmadi" };

  const id = await db.$transaction(async (tx) => {
    // Qoldiq tekshiruvi qulf ostida: bir vaqtdagi ikki zames bitta qoldiqni ikki marta ishlatmasin
    await lockStock(tx);
    // Zayavka bo'yicha qoldiqdan oshmasin (shu mahsulot qatorlari − avvalgi zameslar). Qulf ostida — bir vaqtdagi
    // ikki zames bitta qoldiqni ikki marta egallamaydi. Ortig'i zayavkasiz (sklad uchun) zames qilib yoziladi.
    if (d.orderId) {
      const [ordered, made] = await Promise.all([
        tx.orderItem.aggregate({ where: { orderId: d.orderId, productId: d.productId }, _sum: { qtyM3: true } }),
        tx.productionBatch.aggregate({ where: { orderId: d.orderId, productId: d.productId }, _sum: { qtyM3: true } }),
      ]);
      const left = Number(ordered._sum.qtyM3 ?? 0) - Number(made._sum.qtyM3 ?? 0);
      if (d.qtyM3 > left + STOCK_EPS) {
        throw new ShortError(left > STOCK_EPS
          ? `Zayavka bo'yicha qolgani ${fq(left)} m³ — ${fq(d.qtyM3)} yozib bo'lmaydi. Ortig'ini zayavkasiz zames qiling.`
          : "Bu zayavka bo'yicha shu marka to'liq ishlab chiqarilgan — ortig'ini zayavkasiz zames qiling");
      }
    }
    // Qoldiq tekshiruvi (sklad bo'yicha) — retsept qatori xomashyo yoki boshqa mahsulot bo'lishi mumkin
    // (masalan katta konstruksiyaga tayyor FBS blok kiradi), shuning uchun ikkalasining ham qoldig'i tekshiriladi
    const materialIds = recipe.items.filter((i) => i.materialId).map((i) => i.materialId!);
    const productIds = recipe.items.filter((i) => i.productId).map((i) => i.productId!);
    const [matSums, prodSums] = await Promise.all([
      materialIds.length ? tx.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: d.warehouseId, materialId: { in: materialIds } }, _sum: { qty: true } }) : [],
      productIds.length ? tx.stockMove.groupBy({ by: ["productId"], where: { warehouseId: d.warehouseId, productId: { in: productIds } }, _sum: { qty: true } }) : [],
    ]);
    const matBal = new Map(matSums.map((x) => [x.materialId!, Number(x._sum.qty ?? 0)]));
    const prodBal = new Map(prodSums.map((x) => [x.productId!, Number(x._sum.qty ?? 0)]));
    const lacking = recipe.items
      .map((i) => { const ing = ingredientOf(i); return { ing, need: ing.qtyPerM3 * d.qtyM3, have: balanceOf(ing, matBal, prodBal) }; })
      .filter((x) => x.have < x.need - STOCK_EPS);
    if (lacking.length) {
      throw new ShortError("Yetarli emas: " + lacking.map((x) => `${x.ing.name} (kerak ${fq(x.need)}, bor ${fq(x.have)} ${x.ing.unit})`).join("; "));
    }

    const b = await tx.productionBatch.create({
      data: {
        batchNo: await nextNo(tx, "productionBatch", "ZM"),
        orderId: d.orderId, productId: d.productId, recipeId: recipe.id,
        qtyM3: d.qtyM3, shift: d.shift, note: d.note, createdById: s.userId,
      },
    });
    await tx.stockMove.createMany({
      data: [
        // Ingredient xomashyo bo'lsa materialId, mahsulot bo'lsa productId to'ldiriladi (ikkalasi emas)
        ...recipe.items.map((i) => {
          const ing = ingredientOf(i);
          return {
            type: "PRODUCTION_CONSUME" as const, warehouseId: d.warehouseId,
            materialId: ing.kind === "material" ? ing.key : null,
            productId: ing.kind === "product" ? ing.key : null,
            qty: -(ing.qtyPerM3 * d.qtyM3), refType: "ProductionBatch", refId: b.id, createdById: s.userId,
          };
        }),
        { type: "PRODUCTION_OUTPUT" as const, warehouseId: d.warehouseId, productId: d.productId, qty: d.qtyM3, refType: "ProductionBatch", refId: b.id, createdById: s.userId },
      ],
    });
    if (d.orderId) await tx.order.updateMany({ where: { id: d.orderId, status: "CONFIRMED" }, data: { status: "IN_PRODUCTION" } });
    await audit(tx, s.userId, "CREATE", "ProductionBatch", b.id, undefined, b);
    return b.id;
  }).catch((e: Error) => { if (e instanceof ShortError) return { error: e.message }; throw e; });
  if (typeof id !== "string") return id;
  revalidatePath("/production"); revalidatePath("/orders"); revalidatePath("/");
  redirect(`/production/${id}`);
}
