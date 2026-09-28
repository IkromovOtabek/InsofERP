"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@/generated/prisma";
import { requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { APP_GRANTABLE_ROLES, grantAppAccess, revokeAppAccess } from "@/lib/eco/app-login";

/** Ilova foydalanuvchisiga ERP'ga kirish ruxsati (yoki rolni almashtirish) — faqat direktor. */
export async function grantAccess(ecoUserId: string, phone: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const role = String(fd.get("role") ?? "") as Role;
  if (!APP_GRANTABLE_ROLES.includes(role)) return { error: "Rolni tanlang" };
  try {
    const r = await grantAppAccess(s.userId, ecoUserId, phone, role);
    if (r.error) return r;
  } catch (e) { return { error: (e as Error).message }; }
  revalidatePath("/ilova-foydalanuvchilari");
  return { ok: true };
}

export async function revokeAccess(ecoUserId: string): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = await revokeAppAccess(s.userId, ecoUserId);
  if (r.error) return r;
  revalidatePath("/ilova-foydalanuvchilari");
  return { ok: true };
}
