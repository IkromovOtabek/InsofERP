"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, requireAction } from "@/lib/auth";
import { AccessDenied, notSignedIn } from "@/lib/access-denied";
import { canDo } from "@/lib/permissions";
import { parseForm, type ActionState } from "@/lib/action";
import { isoDate } from "@/lib/format";
import { setTripTtn } from "@/lib/trips";
import {
  ENTRY_CELLS, ENTRY_LABELS as LABEL, LINE_CELLS, NOTE_CELLS, TRIP_CELLS, cancelRealizationEntry, createRealizationEntry, entrySchema, importRealizationEntries, noteSchema,
  saveRealizationLineField, saveRealizationNote, saveRealizationNoteField, saveRealizationTripField, updateRealizationEntry, updateRealizationEntryField,
  type EntryCell, type ImportRow, type LineCell, type NoteCell, type TripCell,
} from "@/lib/realization-log";

/**
 * Logistika → «Realizatsiya» amallari. Qoidalar — `lib/realization-log.ts`; bu yerda ruxsat, forma va sahifani yangilash.
 * Qo'lda qator va Excel import — `logistika.real_manual`, reysdan tushgan qatorni to'ldirish — `logistika.real_auto`.
 */

const refresh = () => revalidatePath("/logistika/realizatsiya");

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

/** Excel'dagi jo'natmalar → qo'lda qatorlar; tugagach reestr import qilingan davr va «Qo'lda» tabi bilan ochiladi. */
export async function importRealizationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "real_manual");
  let rows: unknown;
  let pay: Record<string, string> = {};
  try {
    rows = JSON.parse(String(fd.get("rows") ?? "[]"));
    const raw: unknown = JSON.parse(String(fd.get("valueMaps") || "{}"));
    const m = (raw as Record<string, unknown>)?.payGroup;
    if (m && typeof m === "object") pay = Object.fromEntries(Object.entries(m).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows)) return { error: "Excel ma'lumotlari o'qilmadi" };
  const list = rows.filter((x): x is ImportRow => !!x && typeof x === "object" && !Array.isArray(x));
  const res = await importRealizationEntries(list, { payGroup: pay }, s.userId);
  if ("error" in res) return { error: res.error };
  if (!res.added) return { error: `Yangi qator yo'q: faylning ${res.skipped} ta qatori reestrda bor (reysdan yoki avval kiritilgan)` };
  refresh();
  redirect(`/logistika/realizatsiya?from=${isoDate(res.from)}&to=${isoDate(res.to)}&manba=MANUAL&import=${res.added}-${res.skipped}`);
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

/**
 * Jadval katagidan bitta qiymat (qalamcha): `target` — «m:<qo'lda qator id>», «a:<reys kaliti>», «l:<qator kaliti>» yoki «t:<reys id>» (TTN).
 * Qo'lda qatorda hamma ustun (`real_manual`). Reysdan qatorda xaridordan boshqa hamma ustun (`real_auto`, faqat reestr):
 * «a:» — ortilgan joy, manzil, izoh, spravka nomi va reys bo'yicha tuzatish (sana, to'lov turi, sotuvchi, mashina, reyssizda TTN),
 * «l:» — mahsulot qatori (mahsulot, guruh, o'lchov, miqdor, narx, dastavka). Reys TTN'i reysning o'zida (`trips.create` yoki `real_auto`).
 */
export async function saveRealizationCellAction(target: string, field: string, value: string): Promise<ActionState> {
  const v = String(value ?? "");
  const id = target.slice(2);
  if (target.startsWith("m:") && (ENTRY_CELLS as readonly string[]).includes(field)) {
    const s = await requireAction("logistika", "real_manual");
    const res = await updateRealizationEntryField(id, field as EntryCell, v, s.userId);
    if ("error" in res) return formError(res);
  } else if (target.startsWith("a:") && (NOTE_CELLS as readonly string[]).includes(field)) {
    const s = await requireAction("logistika", "real_auto");
    const res = await saveRealizationNoteField(id, field as NoteCell, v, s.userId);
    if ("error" in res) return formError(res);
  } else if (target.startsWith("a:") && (TRIP_CELLS as readonly string[]).includes(field)) {
    const s = await requireAction("logistika", "real_auto");
    const res = await saveRealizationTripField(id, field as TripCell, v, s.userId);
    if ("error" in res) return formError(res);
  } else if (target.startsWith("l:") && (LINE_CELLS as readonly string[]).includes(field)) {
    const s = await requireAction("logistika", "real_auto");
    const res = await saveRealizationLineField(id, field as LineCell, v, s.userId);
    if ("error" in res) return formError(res);
  } else if (target.startsWith("t:") && field === "ttn") {
    // Reys ochuvchi yoki reestrni yurituvchi dispetcher (qog'oz TTN raqamini shu yerda to'ldiradi)
    const s = await getSession();
    if (!s) throw notSignedIn();
    if (!canDo(s, "trips", "create") && !canDo(s, "logistika", "real_auto")) throw new AccessDenied("Bu amal uchun sizda ruxsat yo'q — direktordan ruxsat so'rang");
    const res = await setTripTtn(id, v, s.userId);
    if ("error" in res) return { error: res.error };
    revalidatePath(`/trips/${id}`); revalidatePath("/trips");
  } else return { error: "Bu katak tahrirlanmaydi" };
  refresh();
  return { ok: true };
}
