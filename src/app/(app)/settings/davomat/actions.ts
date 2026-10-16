"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { parseForm, zDec, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { LATE_FINE_ROLES, saveLateFine } from "@/lib/hr/late-fine";

/* Sozlamalar → Davomat: kechikish jarimasi (otdel kadr va direktor). Qoida — `lib/hr/late-fine.ts`. */

const schema = z.object({
  mode: z.enum(["day", "minute"], { message: "Hisoblash usulini tanlang" }),
  amount: zDec(0),
  graceMinutes: z.coerce.number({ message: "Imtiyoz daqiqasi raqam bo'lsin" }).int("Imtiyoz butun son bo'lsin").min(0, "Imtiyoz manfiy bo'lmasin").max(240, "Imtiyoz ko'pi bilan 240 daqiqa"),
  maxPerMonth: z.preprocess((v) => (v == null || String(v).trim() === "" ? null : v),
    z.coerce.number({ message: "Oylik chegara raqam bo'lsin" }).min(0, "Oylik chegara manfiy bo'lmasin").max(MAX_AMOUNT, "Oylik chegara juda katta").nullable()),
  note: zOpt,
  isActive: z.string().optional().transform((v) => v === "on"),
});

export async function saveLateFineAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...LATE_FINE_ROLES]);
  // Direktor otdel kadr xodimiga "Xodimlar / kadr" modulini yopgan bo'lsa — jarimani ham o'zgartira olmaydi
  if (s.role !== "DIRECTOR" && s.perms?.employees === "none") return { error: "Bu bo'lim sizga yopilgan — direktordan ruxsat so'rang" };
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.isActive && d.amount <= 0) return { error: "Jarima summasini kiriting yoki qoidani o'chirib qo'ying" };
  const res = await saveLateFine(s.userId, {
    amount: Math.round(d.amount * 100) / 100, perMinute: d.mode === "minute", graceMinutes: d.graceMinutes,
    maxPerMonth: d.maxPerMonth == null ? null : Math.round(d.maxPerMonth * 100) / 100, isActive: d.isActive, note: d.note,
  });
  if ("error" in res) return { error: res.error };
  for (const p of ["/settings/davomat", "/settings", "/otdel-kadr", "/hisobim"]) revalidatePath(p);
  return { ok: true, note: res.changed ? "Saqlandi" : "O'zgarish yo'q" };
}
