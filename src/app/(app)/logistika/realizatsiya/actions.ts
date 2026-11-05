"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, type ActionState } from "@/lib/action";
import {
  cancelRealizationEntry, createRealizationEntry, entrySchema, noteSchema, saveRealizationNote, updateRealizationEntry,
} from "@/lib/realization-log";

/**
 * Logistika → «Realizatsiya» amallari. Qoidalar — `lib/realization-log.ts`; bu yerda ruxsat, forma va sahifani yangilash.
 * Qo'lda qator — `logistika.real_manual`, reysdan tushgan qatorni to'ldirish — `logistika.real_auto`.
 */

const refresh = () => revalidatePath("/logistika/realizatsiya");

/** Umumiy son xabari («ko'pi bilan …») qaysi maydonniki ekani ko'rinsin */
const LABEL: Record<string, string> = {
  date: "Sana", qty: "Miqdor", price: "Narx (QQSsiz)", delivery: "Dostavka", customerName: "Xaridor", productName: "Mahsulot",
  seller: "Sotuvchi", groupName: "Guruh", ttn: "TTN", vehicle: "Mashina", loadPlace: "Ortilgan joy", destination: "Boradigan manzil",
  note: "Izoh", refName: "Spravka nomi",
};
const formError = (r: { error: string; field?: string }): ActionState =>
  ({ error: r.field && LABEL[r.field] && !r.error.startsWith(LABEL[r.field]) ? `${LABEL[r.field]}: ${r.error.charAt(0).toLowerCase()}${r.error.slice(1)}` : r.error, field: r.field });

export async function createRealizationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "real_manual");
  const r = parseForm(entrySchema, fd);
  if ("error" in r) return formError(r);
  const res = await createRealizationEntry(r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true, note: "Qator qo'shildi" };
}

export async function updateRealizationAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "real_manual");
  const r = parseForm(entrySchema, fd);
  if ("error" in r) return formError(r);
  const res = await updateRealizationEntry(id, r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true, note: "Saqlandi" };
}

export async function cancelRealizationAction(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("logistika", "real_manual");
  const res = await cancelRealizationEntry(id, String(reason ?? ""), s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function saveRealizationNoteAction(key: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "real_auto");
  const r = parseForm(noteSchema, fd);
  if ("error" in r) return formError(r);
  const res = await saveRealizationNote(key, r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true, note: "Saqlandi" };
}
