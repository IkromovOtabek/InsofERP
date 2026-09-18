"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  supplierId: zStr("Yetkazuvchi tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  date: zStr("Sana kerak"),
  note: zOpt,
  materialId: z.array(z.string()).min(1, "Kamida bitta qator"),
  qty: z.array(z.coerce.number().positive("miqdor 0 dan katta bo'lsin")),
  price: z.array(z.coerce.number().min(0)),
});

/** Kirim: GoodsReceipt + har qator uchun StockMove RECEIPT (+qty, unitCost). */
export async function createReceipt(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PROCUREMENT", "WAREHOUSE"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const items = d.materialId.map((materialId, i) => ({ materialId, qty: d.qty[i], price: d.price[i] })).filter((i) => i.materialId);
  if (!items.length) return { error: "Kamida bitta qator kerak" };

  const id = await db.$transaction(async (tx) => {
    const rec = await tx.goodsReceipt.create({
      data: { docNo: await nextNo(tx, "goodsReceipt", "K"), date: new Date(d.date), supplierId: d.supplierId, warehouseId: d.warehouseId, note: d.note, items: { create: items } },
    });
    await tx.stockMove.createMany({
      data: items.map((i) => ({
        type: "RECEIPT" as const, date: new Date(d.date), warehouseId: d.warehouseId, materialId: i.materialId,
        qty: i.qty, unitCost: i.price, refType: "GoodsReceipt", refId: rec.id, createdById: s.userId,
      })),
    });
    await audit(tx, s.userId, "CREATE", "GoodsReceipt", rec.id, undefined, { ...rec, items });
    return rec.id;
  });
  revalidatePath("/receipts"); revalidatePath("/stock"); revalidatePath("/");
  redirect(`/receipts/${id}`);
}
