"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import {
  cancelAdvanceSheet, closeAdvanceSheet, createAdvanceSheet, giveAdvance, recallAdvanceSheet, refreshAdvanceSheet,
  saveAdvanceAmounts, sendAdvanceSheet, ungiveAdvance,
} from "@/lib/hr/advance-sheet";

/* Avans varaqasi (Ish haqi → Avans, `/avans/<id>`) — qoidalar va ruxsatlar `lib/hr/advance-sheet.ts` da. */

type Items = { lineId: string; amount: string }[];
const cleanItems = (items: unknown): Items =>
  (Array.isArray(items) ? items : []).filter((x): x is Items[number] => !!x && typeof x.lineId === "string" && typeof x.amount === "string").slice(0, 3000);
const refresh = (id?: string) => { revalidatePath("/ish-haqi"); revalidatePath("/avans"); if (id) revalidatePath(`/avans/${id}`); };
const done = (r: { error?: string; ok?: boolean; note?: string }, id?: string): ActionState => {
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
};

export async function createAdvanceSheetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession();
  const r = await createAdvanceSheet(s, { groupKey: String(fd.get("group") ?? "") || null });
  if ("error" in r) return { error: r.error };
  refresh();
  redirect(`/avans/${r.id}`);
}

export async function refreshAdvanceSheetAction(id: string): Promise<ActionState> {
  const s = await requireSession();
  return done(await refreshAdvanceSheet(s, id), id);
}

export async function saveAdvanceAmountsAction(id: string, items: Items): Promise<ActionState> {
  const s = await requireSession();
  const r = await saveAdvanceAmounts(s, id, cleanItems(items));
  if ("error" in r) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.saved ? `Saqlandi (${r.saved} ta o'zgarish)` : "Saqlandi" };
}

export async function sendAdvanceSheetAction(id: string, recipientId: string, items: Items, note: string): Promise<ActionState> {
  const s = await requireSession();
  if (typeof recipientId !== "string") return { error: "Qabul qiluvchini tanlang" };
  return done(await sendAdvanceSheet(s, id, { recipientId, items: cleanItems(items), note: typeof note === "string" ? note : null }), id);
}

export async function recallAdvanceSheetAction(id: string): Promise<ActionState> {
  const s = await requireSession();
  return done(await recallAdvanceSheet(s, id), id);
}

export async function cancelAdvanceSheetAction(id: string, reason: string): Promise<ActionState> {
  const s = await requireSession();
  return done(await cancelAdvanceSheet(s, id, String(reason ?? "")), id);
}

export async function closeAdvanceSheetAction(id: string): Promise<ActionState> {
  const s = await requireSession();
  return done(await closeAdvanceSheet(s, id), id);
}

export async function giveAdvanceAction(id: string, cashAccountId: string, lineIds: string[] | null): Promise<ActionState> {
  const s = await requireSession();
  const ids = Array.isArray(lineIds) ? lineIds.filter((x) => typeof x === "string").slice(0, 3000) : null;
  return done(await giveAdvance(s, id, { cashAccountId: String(cashAccountId ?? ""), lineIds: ids }), id);
}

export async function ungiveAdvanceAction(sheetId: string, lineId: string, reason: string): Promise<ActionState> {
  const s = await requireSession();
  return done(await ungiveAdvance(s, lineId, String(reason ?? "")), sheetId);
}
