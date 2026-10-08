"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { issueSession, requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, type ActionState } from "@/lib/action";
import { confirmSelfChange, requestSelfChangeCode } from "@/lib/self-account";

export type CodeState = { ok?: boolean; error?: string; devCode?: string } | undefined;

/** Login/parol o'zgartirish uchun kod — xodim kartasidagi raqamga (Telegram). Har qanday rol. */
export async function sendSelfCode(_prev: CodeState): Promise<CodeState> {
  const s = await requireSession();
  const r = await requestSelfChangeCode(s.userId);
  return r.ok ? { ok: true, devCode: r.devCode } : { error: r.error };
}

export async function changeSelfCredentials(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession();
  const str = (k: string) => String(fd.get(k) ?? "");
  const password = str("password");
  if (password && password !== str("password2")) return { error: "Yangi parollar bir xil emas" };
  const r = await confirmSelfChange(s.userId, { login: str("login"), password, code: str("code"), currentPassword: str("currentPassword") });
  if (!r.ok) return { error: r.error };
  revalidatePath("/", "layout");
  return { ok: true, note: r.passwordChanged ? "Saqlandi. Boshqa qurilmalarda qayta kirish kerak bo'ladi." : `Saqlandi. Endi login: ${r.login}` };
}

/** Direktor o'z ma'lumotini (F.I.O.) o'zi o'zgartiradi. Boshqa rollarda F.I.O. ni Otdel kadr yuritadi. */
export async function saveMyProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (s.role !== "DIRECTOR") return { error: "Faqat direktor" };
  const r = parseForm(z.object({ fullName: zStr("F.I.O. kerak").pipe(z.string().max(120, "F.I.O. juda uzun")) }), fd);
  if ("error" in r) return { error: r.error };
  const before = await db.user.findUnique({ where: { id: s.userId }, select: { fullName: true } });
  if (before?.fullName === r.data.fullName) return { ok: true };
  const u = await db.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: s.userId }, data: { fullName: r.data.fullName }, select: { id: true, login: true, fullName: true, role: true, sessionVersion: true } });
    await audit(tx, s.userId, "UPDATE", "User", s.userId, before, { fullName: r.data.fullName });
    return u;
  });
  // Ism tokenda ham bor — shu brauzer yangi ism bilan cookie oladi (boshqa sessiyalar kuymaydi: bu xavfsizlik o'zgarishi emas)
  await issueSession(u);
  revalidatePath("/", "layout");
  return { ok: true };
}
