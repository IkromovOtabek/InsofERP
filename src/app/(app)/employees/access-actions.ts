"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { approveAccessAs, rejectAccessRequest } from "@/lib/access-request";
import type { ActionState } from "@/lib/action";
import type { Role } from "@/generated/prisma";

export async function approveAccess(requestId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "login");
  const role = String(fd.get("role") ?? "") as Role;
  // Rol tekshiruvi va moliyaviy/kadr login haqida direktorga xabar — `lib/access-request.ts` (mobil ham shu)
  const r = await approveAccessAs(requestId, role, { userId: s.userId, role: s.role });
  if (!r.ok) return { error: r.error };
  revalidatePath("/employees"); revalidatePath("/settings");
  return { ok: true, note: `Login «${r.login}» ochildi` };
}

export async function rejectAccess(requestId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "login");
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300) || null;
  const r = await rejectAccessRequest(requestId, reason, s.userId);
  if (!r.ok) return { error: r.error };
  revalidatePath("/employees");
  return { ok: true, note: "Ariza rad etildi" };
}
