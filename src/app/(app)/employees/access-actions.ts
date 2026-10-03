"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { POSITIONS } from "@/lib/positions";
import { approveAccessRequest, rejectAccessRequest } from "@/lib/access-request";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import type { ActionState } from "@/lib/action";
import type { Role } from "@/generated/prisma";

/** Arizadan login ochiladigan rollar — faqat bo'lim lavozimlari, direktor emas. */
const ROLES = POSITIONS.filter((p) => p.role !== "DIRECTOR").map((p) => p.role as Role);
const SENSITIVE: Role[] = ["ACCOUNTING", "CASHIER", "FINANCE", "HR", "PROCUREMENT"];

export async function approveAccess(requestId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "login");
  const role = String(fd.get("role") ?? "") as Role;
  if (!ROLES.includes(role)) return { error: "Bo'limni tanlang" };
  const r = await approveAccessRequest(requestId, role, s.userId);
  if (!r.ok) return { error: r.error };
  // Moliyaviy/kadr login — direktor bilib tursin (Otdel kadr ochgan bo'lsa)
  if (SENSITIVE.includes(role) && s.role !== "DIRECTOR") {
    notifyAfter(async () => {
      const who = await db.user.findUnique({ where: { id: s.userId }, select: { fullName: true } });
      await notifyRoles(["DIRECTOR"], {
        type: "SENSITIVE_LOGIN",
        title: "Arizadan moliyaviy/kadr login ochildi",
        body: `login «${r.login}» · bajardi: ${who?.fullName ?? "?"}`,
        link: { key: "employees", id: r.employeeId },
      });
    });
  }
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
