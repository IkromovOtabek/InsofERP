"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { addProductStock } from "@/lib/product-stock";

const schema = z.object({
  productId: zStr("Mahsulot tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  qty: z.coerce.number().int("butun son").positive("miqdor 0 dan katta bo'lsin").max(MAX_AMOUNT, "qiymat juda katta"),
  note: zOpt,
});

/**
 * Hovliga tayyor mahsulotni qo'lda kirim qilish (retseptsiz). Qoida `lib/product-stock.ts` da (mobil ilova ham shundan):
 * faqat HALI HARAKATI YO'Q mahsulotga (boshlang'ich qoldiq) yoki direktor.
 */
export async function addStock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "products");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const raw = fd.get("clientToken");
  const res = await addProductStock({ productId: d.productId, warehouseId: d.warehouseId, qty: d.qty, note: d.note, clientToken: typeof raw === "string" ? raw : null }, { userId: s.userId, role: s.role });
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock"); revalidatePath(`/stock/products/${d.productId}`);
  redirect("/stock?tab=capacity");
}
