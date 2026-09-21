"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  productId: zStr("Mahsulot tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  qty: z.coerce.number().int("butun son").positive("miqdor 0 dan katta bo'lsin"),
  note: zOpt,
});

/** Hovliga tayyor mahsulotni qo'lda kirim qilish (retseptsiz). Sklad harakati: ADJUSTMENT (+). */
export async function addStock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PRODUCTION"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const p = await db.product.findUnique({ where: { id: d.productId } });
  if (!p || p.unit === "m3") return { error: "Faqat dona mahsulot qo'shiladi" };
  await db.$transaction(async (tx) => {
    const m = await tx.stockMove.create({ data: { type: "ADJUSTMENT", warehouseId: d.warehouseId, productId: d.productId, qty: d.qty, note: d.note ?? "Qo'lda qo'shildi", refType: "Manual", createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "StockMove", m.id, undefined, { product: p.code, qty: d.qty, note: d.note });
  });
  revalidatePath("/stock"); revalidatePath(`/stock/products/${d.productId}`);
  redirect("/stock?tab=capacity");
}
