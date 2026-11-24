"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { saveInventoryCount, saveProductCount, saveStockWriteOff } from "@/lib/stock-adjust";
import { WRITE_OFF_REASONS } from "@/lib/stock-adjust-const";

/**
 * Sklad qoldig'ini HUJJAT bilan o'zgartirish: inventarizatsiya (sanoq farqi, ADJUSTMENT ±) va hisobdan chiqarish
 * (spisanie, WRITE_OFF −). Qoida `lib/stock-adjust.ts` da — mobil ilova ham shundan chaqiradi.
 * Kim: stock → "adjust" amali (lib/permissions.ts) — sklad (WAREHOUSE), direktor va u ruxsat bergan xodim.
 */

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function refresh() {
  revalidatePath("/stock"); revalidatePath("/stock/inventarizatsiya"); revalidatePath("/stock/spisanie"); revalidatePath("/stock/rasxod");
  revalidatePath("/dashboard"); revalidatePath("/snabjeniye");
}

/** Jadval — JSON (`rows`); o'qilmasa — null. */
function jsonRows(fd: FormData): unknown[] | null {
  try {
    const v: unknown = JSON.parse(String(fd.get("rows") ?? "[]"));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

// ───────────────────────── Inventarizatsiya ─────────────────────────

export async function saveInventory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "adjust");
  const reason = text(fd, "reason");
  if (!reason) return { error: "Farq sababini yozing (masalan: oylik sanoq, tarozi xatosi, o'g'irlik)" };
  const rows = jsonRows(fd);
  if (!rows) return { error: "Jadval o'qilmadi" };
  const r = await saveInventoryCount({ warehouseId: text(fd, "warehouseId"), reason, rows }, s.userId);
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true, note: r.note };
}

/** Tayyor dona mahsulot sanog'i (sanoq akti) — xomashyo sanog'i bilan bir ruxsat. Qoida `saveProductCount` da. */
export async function saveProductInventory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "adjust");
  const reason = text(fd, "reason");
  if (!reason) return { error: "Farq sababini yozing (masalan: oy oxiri sanog'i, hisobga olinmagan sotuv)" };
  const rows = jsonRows(fd);
  if (!rows) return { error: "Jadval o'qilmadi" };
  const r = await saveProductCount({ warehouseId: text(fd, "warehouseId"), reason, rows }, s.userId);
  if ("error" in r) return { error: r.error };
  refresh(); revalidatePath("/stock/inventarizatsiya/tayyor"); revalidatePath("/stock/umumiy");
  return { ok: true, note: r.note };
}

// ───────────────────────── Hisobdan chiqarish (spisanie) ─────────────────────────

export async function saveWriteOff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "adjust");
  const kind = text(fd, "kind");
  const note = text(fd, "note");
  if (!(WRITE_OFF_REASONS as readonly string[]).includes(kind)) return { error: "Sababni tanlang" };
  if (!note) return { error: "Izoh majburiy — nima bo'ldi, kim aniqladi" };
  const rows = jsonRows(fd);
  if (!rows) return { error: "Jadval o'qilmadi" };
  const r = await saveStockWriteOff({ warehouseId: text(fd, "warehouseId"), kind, note, rows }, s.userId);
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true, note: r.note };
}
