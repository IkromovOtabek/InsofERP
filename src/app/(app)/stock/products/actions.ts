"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { addProductStockLines } from "@/lib/product-stock";

const schema = z.object({
  warehouseId: zStr("Sklad tanlanmagan"),
  // Kirim sanasi (YYYY-MM-DD); bo'sh — bugun. Qoidasi `lib/product-stock.ts` da
  date: zOpt,
  productId: z.array(z.string()).min(1, "Kamida bitta mahsulot qatori kerak"),
  qty: z.array(z.coerce.number({ message: "Miqdor raqam bo'lsin" }).int("Miqdor butun son bo'lsin").positive("Miqdor 0 dan katta bo'lsin").max(MAX_AMOUNT, "Qiymat juda katta")),
  note: zOpt,
});

/**
 * Hovliga tayyor mahsulotni qo'lda kirim qilish (retseptsiz) — bir nechta qator, tanlangan sana bilan.
 * Qoida `lib/product-stock.ts` da (mobil ilova ham shundan): faqat HALI HARAKATI YO'Q mahsulotga (boshlang'ich qoldiq) yoki direktor.
 */
export async function addStock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "products");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const raw = fd.get("clientToken");
  const lines = d.productId.map((productId, i) => ({ productId, qty: d.qty[i] ?? 0 }));
  const res = await addProductStockLines({ lines, warehouseId: d.warehouseId, date: d.date, note: d.note, clientToken: typeof raw === "string" ? raw : null }, { userId: s.userId, role: s.role });
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock");
  for (const id of new Set(d.productId)) revalidatePath(`/stock/products/${id}`);
  redirect("/stock?tab=capacity");
}
