"use client";

import { createContext, useContext } from "react";
import type { AdminRoleT } from "@/lib/control/roles";

/**
 * Joriy admin: rol (tugmalarni oldindan o'chirish uchun) va 2FA yoqilganmi (qayta tasdiqda kod maydoni).
 * Faqat ko'rinish uchun — ruxsat har doim serverda tekshiriladi.
 */
export type AdminCtx = { role: AdminRoleT; totp: boolean };
const Ctx = createContext<AdminCtx>({ role: "VIEWER", totp: false });

export function AdminCtxProvider({ value, children }: { value: AdminCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAdminCtx = () => useContext(Ctx);
