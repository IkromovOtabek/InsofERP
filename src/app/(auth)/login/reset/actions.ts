"use server";

import { confirmPasswordReset, requestPasswordReset } from "@/lib/password-reset";

export type RequestState = { error?: string; sent?: boolean; devCode?: string } | undefined;
export type ConfirmState = { error?: string; login?: string } | undefined;

/** 1-qadam: telefon → SMS kod. */
export async function requestCodeAction(_prev: RequestState, fd: FormData): Promise<RequestState> {
  const phone = String(fd.get("phone") ?? "");
  if (!phone.trim()) return { error: "Telefon raqamini kiriting" };
  const r = await requestPasswordReset(phone);
  if (!r.ok) return { error: r.error };
  return { sent: true, devCode: r.devCode };
}

/** 2-qadam: kod + yangi parol. */
export async function confirmResetAction(_prev: ConfirmState, fd: FormData): Promise<ConfirmState> {
  const phone = String(fd.get("phone") ?? "");
  const code = String(fd.get("code") ?? "");
  const password = String(fd.get("password") ?? "");
  const password2 = String(fd.get("password2") ?? "");
  if (!code.trim()) return { error: "SMS'dagi kodni kiriting" };
  if (password !== password2) return { error: "Parollar bir xil emas" };

  const r = await confirmPasswordReset(phone, code, password);
  if (!r.ok) return { error: r.error };
  return { login: r.login };
}
