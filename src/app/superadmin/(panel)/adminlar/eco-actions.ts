"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/control/auth";
import { linkOwnEco, unlinkOwnEco } from "@/lib/control/eco-login";
import { clientIp } from "@/lib/login-guard";
import type { ActionState } from "@/lib/action";

/**
 * "Mening hisobim" → ECO hisobini ulash / uzish. Admin id faqat sessiyadan (`requireAdmin`):
 * forma boshqa adminning id'sini yubora olmaydi. Ikkalasi ham joriy panel paroli bilan (reauth).
 */
export async function linkOwnEcoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireAdmin();
  const r = await linkOwnEco(a.id, {
    phone: String(fd.get("phone") ?? "").trim(),
    ecoPassword: String(fd.get("ecoPassword") ?? ""),
    currentPassword: fd.get("current"),
  }, await clientIp());
  if (r.error) return { error: r.error };
  revalidatePath("/superadmin/adminlar");
  return { ok: true, note: `ECO hisobi ulandi: ${r.phone}` };
}

export async function unlinkOwnEcoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireAdmin();
  const r = await unlinkOwnEco(a.id, fd.get("current"), await clientIp());
  if (r.error) return { error: r.error };
  revalidatePath("/superadmin/adminlar");
  return { ok: true, note: "ECO hisobi uzildi" };
}
