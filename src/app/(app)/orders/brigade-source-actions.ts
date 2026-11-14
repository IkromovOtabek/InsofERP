"use server";

import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { parseYardQuery, yardMoves, type YardMoves } from "@/lib/yard-moves";
import type { YardMovesQuery } from "@/components/yard-moves-dialog";

/**
 * Zayavka formasidagi «Brigadadan olish» ustuni: brigada nomi / erkin soni bosilsa — shu brigada omboridagi mahsulot harakatlari
 * (kim, qachon, qaysi hujjat bilan kirgan/chiqqan). Zayavka ochadigan yoki tahrirlaydigan xodimga; faqat bitta brigada ombori.
 */
export async function brigadeMovesInfo(q: YardMovesQuery): Promise<{ data?: YardMoves; error?: string }> {
  const s = await requirePage("/orders");
  if (!canDo(s, "orders", "create") && !canDo(s, "orders", "edit") && !canDo(s, "orders", "excel")) return { error: "Zayavka bo'limida ruxsatingiz yo'q" };
  const p = parseYardQuery(q);
  if (!p || !p.owner || p.owner === "*") return { error: "Noto'g'ri so'rov" };
  const data = await yardMoves({ ...p, dir: "all", from: null, to: null });
  return data ? { data } : { error: "Mahsulot topilmadi — sahifani yangilang" };
}
