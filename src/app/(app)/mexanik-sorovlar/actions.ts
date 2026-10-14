"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModuleWrite } from "@/lib/auth";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";
import { MECH_ROLES, approveMechanicRequest, cancelMechanicRequest, payMechanicRequest, rejectMechanicRequest } from "@/lib/mechanic-requests";

/**
 * Mexanik so'rovi amallari (veb). Qoida `lib/mechanic-requests.ts` da — mobil ilova ham shuni chaqiradi.
 * Tasdiq/rad — ish boshqaruvchi, pul — kassa, bekor — so'rov egasi (mexanik); direktor `requireModuleWrite` dan har doim o'tadi.
 */
function refresh(id: string) {
  revalidatePath("/mexanik-sorovlar"); revalidatePath(`/mexanik-sorovlar/${id}`);
  revalidatePath("/cashflow"); revalidatePath("/dashboard"); revalidatePath("/logistika/xarajatlar");
}

export async function approve(id: string): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.decide);
  const r = await approveMechanicRequest(id, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

const RejectSchema = z.object({ reason: zStr("Rad etish sababini yozing") });
export async function reject(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.decide);
  const p = parseForm(RejectSchema, fd);
  if ("error" in p) return { error: p.error };
  const r = await rejectMechanicRequest(id, p.data.reason, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

const PaySchema = z.object({ cashAccountId: zStr("Kassa / hisob tanlanmagan"), note: zOpt });
export async function pay(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.pay);
  const p = parseForm(PaySchema, fd);
  if ("error" in p) return { error: p.error };
  const r = await payMechanicRequest(id, { cashAccountId: p.data.cashAccountId, note: p.data.note }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function cancel(id: string): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.create);
  // Egalik va holat `cancelMechanicRequest` ichida: faqat o'z so'rovi, faqat tasdiqdan oldin
  const r = await cancelMechanicRequest(id, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}
