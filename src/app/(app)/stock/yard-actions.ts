"use server";

import { requirePage } from "@/lib/page-guard";
import { canSee } from "@/lib/nav";
import { parseYardQuery, yardMoves, type YardMoves } from "@/lib/yard-moves";
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
  return data ? { data } : { error: "Mahsulot topilmadi — sahifani yangilang" };
}
