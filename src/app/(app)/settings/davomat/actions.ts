"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { LATE_FINE_ROLES } from "@/lib/hr/late-fine";
import { saveLateFineCore } from "@/lib/kadr-ops";

/* Sozlamalar → Davomat: kechikish jarimasi (otdel kadr va direktor). Qoida — `lib/hr/late-fine.ts`, forma — `lib/kadr-ops.ts` (mobil ham). */

export async function saveLateFineAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...LATE_FINE_ROLES]);
  // Direktor otdel kadr xodimiga "Xodimlar / kadr" modulini yopgan bo'lsa — jarimani ham o'zgartira olmaydi
  if (s.role !== "DIRECTOR" && s.perms?.employees === "none") return { error: "Bu bo'lim sizga yopilgan — direktordan ruxsat so'rang" };
  const res = await saveLateFineCore(s.userId, fd);
  if ("error" in res) return { error: res.error };
  for (const p of ["/settings/davomat", "/settings", "/otdel-kadr", "/hisobim"]) revalidatePath(p);
  return { ok: true, note: res.note };
}
