"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zStr, zOpt, type ActionState } from "@/lib/action";
import { setDefectAmount } from "@/lib/defects";
import { saveBrigade as saveBrigadeData } from "@/lib/brigades";

const schema = z.object({
  name: zStr("Brigada nomi kerak"),
  leaderId: zOpt,
  phone: zOpt,
  note: zOpt,
});

/** Brigada ochish / tahrirlash — qoida `lib/brigades.ts` da (mobil ilova ham shuni chaqiradi). */
export async function saveBrigade(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("tasks", "brigade");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const res = await saveBrigadeData(id, r.data, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/brigades"); revalidatePath("/orders/new");
  return { ok: true };
}

/**
 * Brigadani nofaol qilish / qayta yoqish. Ochiq (yangi yoki bajarilayotgan) topshirig'i bor brigada nofaol
 * qilinmaydi — aks holda topshiriqlar egasiz qolib, brigadir ilovada ularni ko'rmay qoladi.
 */
export async function toggleBrigade(id: string): Promise<ActionState> {
  const s = await requireAction("tasks", "brigade");
  const b = await db.brigade.findUnique({ where: { id } });
  if (!b) return { error: "Brigada topilmadi" };
  if (b.isActive) {
    const open = await db.brigadeTask.count({ where: { brigadeId: id, status: { in: ["NEW", "IN_PROGRESS"] } } });
    if (open > 0) return { error: `«${b.name}» da ${open} ta ochiq topshiriq bor — avval Topshiriqlar bo'limida ularni bajaring yoki bekor qiling` };
  }
  // Shartli yangilash: shu payt boshqa joyda o'zgargan bo'lsa ikki marta almashmasin
  const changed = await db.$transaction(async (tx) => {
    const r = await tx.brigade.updateMany({ where: { id, isActive: b.isActive }, data: { isActive: !b.isActive } });
    if (r.count !== 1) return false;
    await audit(tx, s.userId, "UPDATE", "Brigade", id, { isActive: b.isActive }, { isActive: !b.isActive });
    return true;
  });
  if (!changed) return { error: "Brigada holati shu payt boshqa joyda o'zgardi — sahifani yangilang" };
  revalidatePath("/brigades"); revalidatePath("/orders/new");
  return { ok: true, note: b.isActive ? "Nofaol qilindi" : "Faollashtirildi" };
}

/** Brak summasini tahrirlash — brigada oyligidan ushlanadigan pul (`lib/defects.ts`). */
export async function saveDefectAmount(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("tasks", "pay");
  const r = parseForm(z.object({ amount: zDec() }), fd);
  if ("error" in r) return { error: r.error };
  const res = await setDefectAmount(id, r.data.amount, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/brigades"); revalidatePath("/dashboard");
  return { ok: true };
}
