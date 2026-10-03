"use server";

import { clientIp } from "@/lib/login-guard";
import { submitAccessRequest, verifyAccessRequest, type SignupVia } from "@/lib/access-request";

export type SignupState = { error?: string; requestId?: string; phone?: string; via?: SignupVia; devCode?: string } | undefined;

/** 1-qadam: ariza ma'lumotlari → telefonga tasdiqlash kodi. */
export async function submitSignupAction(_prev: SignupState, fd: FormData): Promise<SignupState> {
  const get = (k: string) => String(fd.get(k) ?? "");
  const r = await submitAccessRequest({
    fullName: get("fullName"), phone: get("phone"), position: get("position"), login: get("login"),
    password: get("password"), password2: get("password2"), note: get("note"),
  }, await clientIp());
  if (!r.ok) return { error: r.error };
  return { requestId: r.requestId, phone: r.phone, via: r.via, devCode: r.devCode };
}

/** 2-qadam: kod → ariza HR/direktorga tushadi. */
export async function verifySignupAction(_prev: { error?: string; done?: boolean } | undefined, fd: FormData) {
  const id = String(fd.get("requestId") ?? "");
  const code = String(fd.get("code") ?? "");
  if (!code.trim()) return { error: "Kodni kiriting" };
  const r = await verifyAccessRequest(id, code);
  return r.ok ? { done: true } : { error: r.error };
}
