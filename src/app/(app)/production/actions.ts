"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/auth";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";
import { batchSchema, createProductionBatch } from "@/lib/production-batch";
import { cancelBatch } from "@/lib/storno";
import { orderReschedule } from "@/lib/orders";
import { createStockOrder as createStockOrderDomain } from "@/lib/stock-orders";

const stockSchema = z.object({
  dueDate: zStr("Tayyor bo'lish muddati kerak").refine((v) => Number.isFinite(new Date(v).getTime()), "Tayyor bo'lish muddati noto'g'ri"),
  isUrgent: z.string().optional().transform((v) => v === "on"),
  note: zOpt,
  productId: z.array(z.string()).min(1, "Kamida bitta mahsulot"),
  qty: z.array(z.coerce.number({ message: "Miqdor raqam bo'lsin" }).positive("Miqdor 0 dan katta bo'lsin").max(100_000, "Miqdor juda katta (100 000 dan oshmasin)")),
});

/**
 * «Skladga zayavka» (zaxiraga ishlab chiqarish): mijozsiz, narxsiz. Ochgan xodimda sklad zayavkasini qabul qilish
 * ruxsati ham bor (`orders` → `stock`), shuning uchun zayavka darhol qabul qilinadi va shu oynada brigada tayinlash
 * ochiladi — matritsa va doskada ham ko'rinadi. Qoida `lib/stock-orders.ts` da.
 */
export async function createStockOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("orders", "stock");
  const r = parseForm(stockSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  let res;
  try {
    res = await createStockOrderDomain({
      dueDate: new Date(d.dueDate),
      items: d.productId.map((productId, i) => ({ productId, qtyM3: d.qty[i] ?? 0 })).filter((i) => i.productId && i.qtyM3 > 0),
      isUrgent: d.isUrgent,
      note: d.note,
      confirmed: true,
    }, s.userId);
  } catch (e) {
    const err = e as Error;
    if (err?.name?.startsWith("PrismaClient")) { console.error("[production] sklad zayavkasi", e); return { error: "Zayavka saqlanmadi: ma'lumotlarni tekshirib, qayta urinib ko'ring" }; }
    return { error: err?.message || "Zayavka saqlanmadi" };
  }

  revalidatePath("/production"); revalidatePath("/orders"); revalidatePath("/stock");
  redirect(`/production?order=${res.id}&yangi=1`);
}

/**
 * Zames qaydi: retsept bo'yicha xomashyo sarfi, tayyor mahsulot kirimi, zayavka → IN_PRODUCTION.
 * Qoida `lib/production-batch.ts` da — mobil ilova ham shuni chaqiradi.
 */
export async function createBatch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("production", "batch");
  const r = parseForm(batchSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await createProductionBatch(r.data, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/production"); revalidatePath("/orders"); revalidatePath("/");
  redirect(`/production/${res.id}`);
}

/**
 * Zamesni storno qilish — faqat direktor (yoki direktor "Zamesni storno qilish" amalini bergan xodim).
 * Qoida `lib/storno.ts` da: xomashyo qaytadi, mahsulot chiqariladi; mahsulot jo'natilgan bo'lsa rad.
 */
export async function stornoBatch(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("production", "batch_storno");
  const r = await cancelBatch(id, String(reason ?? "").slice(0, 300), s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/production"); revalidatePath(`/production/${id}`); revalidatePath("/orders"); revalidatePath("/stock"); revalidatePath("/trips"); revalidatePath("/");
  return { ok: true, note: r.note };
}

/** Doskadagi kartada sanani bosib zayavkani boshqa kunga ko'chirish. Qoida `lib/orders.ts` (`orderReschedule`) da. */
export async function rescheduleOrder(id: string, day: string): Promise<ActionState> {
  const s = await requireAction("production", "reschedule");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Sanani tanlang" };
  const r = await orderReschedule(id, new Date(day), s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/production"); revalidatePath("/orders"); revalidatePath(`/orders/${id}`); revalidatePath("/tasks");
  return { ok: true, note: "Sana o'zgardi" };
}
