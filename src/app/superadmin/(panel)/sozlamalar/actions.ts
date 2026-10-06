"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/control/auth";
import { logEvent } from "@/lib/control/events";
import { encodeUiCookie, UI_PREFS_COOKIE, type UiPrefs } from "@/lib/control/ui-prefs";
import { saveOwnUiPrefs } from "@/lib/control/ui-prefs-db";

/**
 * Panel mavzusi (telefon ko'rinishi, rang rejimi) — faqat JORIY admin o'zinikini yozadi.
 * Kim — sessiyadan (requireAdmin); tanadagi qiymat zod bilan qat'iy tekshiriladi (ortiqcha kalit — rad).
 */
export async function saveUiPrefs(input: unknown): Promise<{ ok?: true; prefs?: UiPrefs; error?: string }> {
  const me = await requireAdmin();
  const r = await saveOwnUiPrefs(me.id, input);
  if (!r.ok) return { error: r.error };
  if (r.prev.mobileLayout !== r.prefs.mobileLayout || r.prev.colorMode !== r.prefs.colorMode) {
    await logEvent(me.id, "ADMIN_PREFS", null, { from: r.prev, to: r.prefs });
  }
  (await cookies()).set(UI_PREFS_COOKIE, encodeUiCookie(r.prefs), {
    // httpOnly emas: maxfiy emas, panel ochilganda klient uni bazadagi qiymatga tenglaydi (yangi qurilmada ham)
    httpOnly: false, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/superadmin", maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/superadmin", "layout");
  return { ok: true, prefs: r.prefs };
}
