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

const schema = z.object({
  orderId: zOpt,
  productId: zStr("Marka tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  qtyM3: z.coerce.number().positive("miqdor 0 dan katta bo'lsin"),
  shift: z.coerce.number().int().min(1).max(3),
  note: zOpt,
});

/**
 * Zames qaydi. Bitta tranzaksiyada:
 *  1) faol retsept bo'yicha har bir xomashyo uchun PRODUCTION_CONSUME (−)
 *  2) tayyor beton uchun PRODUCTION_OUTPUT (+)
 *  3) zayavka → IN_PRODUCTION
 * Xomashyo yetmasa — xato, hech narsa yozilmaydi.
 */
export async function createBatch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  const recipe = await db.recipe.findFirst({ where: { productId: d.productId, isActive: true }, include: { items: { include: { material: true } } } });
  if (!recipe) return { error: "Bu marka uchun faol retsept yo'q. Avval retsept kiriting." };

  // Qoldiq tekshiruvi (sklad bo'yicha)
  const sums = await db.stockMove.groupBy({
    by: ["materialId"],
    where: { warehouseId: d.warehouseId, materialId: { in: recipe.items.map((i) => i.materialId) } },
    _sum: { qty: true },
  });
  const bal = new Map(sums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  const lacking = recipe.items
    .map((i) => ({ i, need: Number(i.qtyPerM3) * d.qtyM3, have: bal.get(i.materialId) ?? 0 }))
    .filter((x) => x.have < x.need);
  if (lacking.length) {
    return { error: "Xomashyo yetarli emas: " + lacking.map((x) => `${x.i.material.name} (kerak ${fq(x.need)}, bor ${fq(x.have)} ${x.i.material.unit})`).join("; ") };
  }

  if (d.orderId) {
    const o = await db.order.findUnique({ where: { id: d.orderId } });
    if (!o || !["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { error: "Zayavka tasdiqlanmagan yoki yopilgan" };
  }

  const id = await db.$transaction(async (tx) => {
    const b = await tx.productionBatch.create({
      data: {
        batchNo: await nextNo(tx, "productionBatch", "ZM"),
        orderId: d.orderId, productId: d.productId, recipeId: recipe.id,
        qtyM3: d.qtyM3, shift: d.shift, note: d.note, createdById: s.userId,
      },
    });
    await tx.stockMove.createMany({
      data: [
        ...recipe.items.map((i) => ({
          type: "PRODUCTION_CONSUME" as const, warehouseId: d.warehouseId, materialId: i.materialId,
          qty: -(Number(i.qtyPerM3) * d.qtyM3), refType: "ProductionBatch", refId: b.id, createdById: s.userId,
        })),
        { type: "PRODUCTION_OUTPUT" as const, warehouseId: d.warehouseId, productId: d.productId, qty: d.qtyM3, refType: "ProductionBatch", refId: b.id, createdById: s.userId },
      ],
    });
    if (d.orderId) await tx.order.updateMany({ where: { id: d.orderId, status: "CONFIRMED" }, data: { status: "IN_PRODUCTION" } });
    await audit(tx, s.userId, "CREATE", "ProductionBatch", b.id, undefined, b);
    return b.id;
  });
  revalidatePath("/production"); revalidatePath("/orders"); revalidatePath("/");
  redirect(`/production/${id}`);
}
