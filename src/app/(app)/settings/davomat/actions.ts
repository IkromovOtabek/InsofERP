"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { saveLateFineCore } from "@/lib/kadr-ops";

/* Sozlamalar → Davomat: kechikish jarimasi (otdel kadr va direktor). Qoida — `lib/hr/late-fine.ts`, forma — `lib/kadr-ops.ts` (mobil ham). */

export async function saveLateFineAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  // Rol bo'yicha — otdel kadr; direktor Ruxsatlarda «Xodimlar / kadr → Kechikish jarimasi» ni boshqaga berishi yoki yopishi mumkin
  const s = await requireAction("employees", "late_fine");
  const res = await saveLateFineCore(s.userId, fd);
  if ("error" in res) return { error: res.error };
  for (const p of ["/settings/davomat", "/settings", "/otdel-kadr", "/hisobim"]) revalidatePath(p);
  return { ok: true, note: res.note };
}
