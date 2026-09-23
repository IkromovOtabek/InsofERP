"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { issueToBrigade, returnFromBrigade } from "@/lib/brigade-stock";

type Row = { materialId: string; qty: number; brigadeId: string };

const refresh = () => {
  revalidatePath("/stock"); revalidatePath("/brigades"); revalidatePath("/production"); revalidatePath("/tasks");
};

/**
 * Sklad jadvalidan brigadalarga taqsimlash: har qatorda miqdor va brigada tanlanadi.
 * Bitta amalda bir necha brigadaga berilishi mumkin — brigada bo'yicha guruhlanadi.
 * Skladdagidan ko'p berilmaydi: yig'indi tekshiruvi `lib/brigade-stock.ts` da.
 */
export async function distributeToBrigade(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR"]);
  let rows: Row[];
  try { rows = JSON.parse(String(fd.get("rows") ?? "[]")); } catch { return { error: "Jadval o'qilmadi" }; }
  rows = rows.filter((r) => r.materialId && r.brigadeId && r.qty > 0);
  if (!rows.length) return { error: "Kamida bitta mahsulotga miqdor va brigada belgilang" };
  const warehouseId = String(fd.get("warehouseId") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;

  const byBrigade = new Map<string, Row[]>();
  for (const r of rows) byBrigade.set(r.brigadeId, [...(byBrigade.get(r.brigadeId) ?? []), r]);

  const done: string[] = [];
  for (const [brigadeId, list] of byBrigade) {
    const r = await issueToBrigade({ brigadeId, warehouseId, note, rows: list.map((x) => ({ materialId: x.materialId, qty: x.qty })) }, s.userId);
    if (r.error) { refresh(); return { error: `${r.error}${done.length ? ` (oldingi ${done.length} brigada berildi)` : ""}` }; }
    done.push(r.note ?? brigadeId);
  }
  refresh();
  return { ok: true, note: done.join(" · ") };
}

/** Brigadadan ishlatilmagan xomashyoni skladga qaytarish. */
export async function returnToStock(brigadeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR"]);
  const materialId = String(fd.get("materialId") ?? "");
  const qty = Number(String(fd.get("qty") ?? "").replace(",", ".")) || 0;
  const warehouseId = String(fd.get("warehouseId") ?? "");
  if (!materialId || qty <= 0) return { error: "Xomashyo va miqdorni belgilang" };
  const r = await returnFromBrigade({ brigadeId, warehouseId, rows: [{ materialId, qty }], note: "Brigadadan qaytarildi" }, s.userId);
  if (r.error) return { error: r.error };
  refresh();
  return { ok: true, note: r.note };
}
