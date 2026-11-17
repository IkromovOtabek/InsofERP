"use server";

import { revalidatePath } from "next/cache";
import { requirePage } from "@/lib/page-guard";
import { canSee } from "@/lib/nav";
import { requireAction } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { deleteYardMove, editYardMove, parseYardQuery, yardMoves, type YardEdit, type YardMoves } from "@/lib/yard-moves";
import type { YardMovesQuery } from "@/components/yard-moves-dialog";

/**
 * Sklad → Hovli jadvalidagi Kirim / Chiqim katagi: shu mahsulot va ombor bo'yicha davrdagi harakatlar (kim, qachon, hujjat).
 * Hovli oynasini ko'ra oladigan xodimga (`stock` → «hovli» tugmasi).
 */
export async function yardMovesInfo(q: YardMovesQuery): Promise<{ data?: YardMoves; error?: string }> {
  const s = await requirePage("/stock");
  if (!canSee(s, "stock", "hovli")) return { error: "Hovli oynasi sizga yopiq — direktordan ruxsat so'rang" };
  const p = parseYardQuery(q);
  if (!p) return { error: "Noto'g'ri so'rov" };
  const data = await yardMoves(p);
  return data ? { data: { ...data, can: { edit: canDo(s, "stock", "yard_edit"), del: canDo(s, "stock", "yard_delete") } } } : { error: "Mahsulot topilmadi — sahifani yangilang" };
}

const refreshStock = () => { revalidatePath("/stock", "layout"); revalidatePath("/production", "layout"); revalidatePath("/orders", "layout"); };

/** Oynadagi yozuv: miqdor (yo'nalishi saqlanadi), sana, izoh — `stock.yard_edit`. Qoidalar — `lib/yard-moves.ts`. */
export async function editYardMoveAction(id: string, input: YardEdit): Promise<{ ok?: true; error?: string }> {
  const s = await requireAction("stock", "yard_edit");
  const r = await editYardMove(String(id), { qty: Number(input?.qty), date: String(input?.date ?? ""), note: String(input?.note ?? "") }, s.userId);
  if ("error" in r) return { error: r.error };
  refreshStock();
  return { ok: true };
}

/** Oynadagi yozuvni o'chirish — `stock.yard_delete`. */
export async function deleteYardMoveAction(id: string): Promise<{ ok?: true; error?: string }> {
  const s = await requireAction("stock", "yard_delete");
  const r = await deleteYardMove(String(id), s.userId);
  if ("error" in r) return { error: r.error };
  refreshStock();
  return { ok: true };
}
