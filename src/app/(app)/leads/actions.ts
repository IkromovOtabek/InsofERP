"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import { convertLead as convert, saveLeadNote as saveNote, setLeadStatus as setStatus } from "@/lib/leads";

const ROLES = ["SALES", "DIRECTOR"] as const;

/** Holatni almashtirish (bog'landim / bekor). Qoida `lib/leads.ts` da — mobil ilova ham shuni chaqiradi. */
export async function setLeadStatus(leadId: string, status: "NEW" | "IN_PROGRESS" | "REJECTED") {
  const s = await requireSession([...ROLES]);
  const r = await setStatus(leadId, status, s.userId);
  if (!r.ok) throw new Error(r.error);
  revalidatePath("/leads");
}

/** Sotuvchining ichki izohi. */
export async function saveLeadNote(leadId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession([...ROLES]);
  const r = parseForm(z.object({ note: zOpt }), fd);
  if ("error" in r) return { error: r.error };
  const res = await saveNote(leadId, r.data.note ?? null);
  if (!res.ok) return { error: res.error };
  revalidatePath("/leads");
  return { ok: true };
}

/** Arizani mijozga aylantirish. */
export async function convertLead(leadId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...ROLES]);
  const r = parseForm(z.object({ name: z.string().trim().min(2, "nomi to'liq yozilsin"), inn: zOpt }), fd);
  if ("error" in r) return { error: r.error };
  const res = await convert(leadId, { name: r.data.name, inn: r.data.inn }, s.userId);
  if (!res.ok) return { error: res.error };
  revalidatePath("/leads"); revalidatePath("/customers");
  return { ok: true, note: res.note };
}
