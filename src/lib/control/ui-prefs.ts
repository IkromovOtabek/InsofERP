import { z } from "zod";

/**
 * Superadmin panel ko'rinishi (har admin uchun, control bazada `SuperAdmin.uiPrefs`).
 * Bu fayl sof: Prisma/Node yo'q — klient komponentlar ham import qiladi.
 *  - mobileLayout: telefon (≤ 760px) ko'rinishi — "widgets" (M4 Vidjetlar) yoki "pro" (M5 Zich Pro). Kompyuter o'zgarmaydi.
 *  - colorMode: "system" | "light" | "dark".
 */
export const MOBILE_LAYOUTS = ["widgets", "pro"] as const;
export const COLOR_MODES = ["system", "light", "dark"] as const;
export type MobileLayout = (typeof MOBILE_LAYOUTS)[number];
export type ColorMode = (typeof COLOR_MODES)[number];
export type UiPrefs = { mobileLayout: MobileLayout; colorMode: ColorMode };

export const DEFAULT_UI_PREFS: UiPrefs = { mobileLayout: "widgets", colorMode: "system" };

/** Yangilash so'rovi: faqat shu ikki kalit, ortiqcha maydon (masalan adminId) — rad. */
export const uiPrefsPatch = z.strictObject({
  mobileLayout: z.enum(MOBILE_LAYOUTS).optional(),
  colorMode: z.enum(COLOR_MODES).optional(),
}).refine((v) => v.mobileLayout !== undefined || v.colorMode !== undefined, { message: "O'zgarish yo'q" });
export type UiPrefsPatch = z.infer<typeof uiPrefsPatch>;

/** Bazadagi Json → to'liq prefs (buzuq yoki eski qiymat bo'lsa — standart). */
export function readUiPrefs(v: unknown): UiPrefs {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return {
    mobileLayout: (MOBILE_LAYOUTS as readonly unknown[]).includes(o.mobileLayout) ? (o.mobileLayout as MobileLayout) : DEFAULT_UI_PREFS.mobileLayout,
    colorMode: (COLOR_MODES as readonly unknown[]).includes(o.colorMode) ? (o.colorMode as ColorMode) : DEFAULT_UI_PREFS.colorMode,
  };
}

/**
 * Cookie — login sahifasi (sessiyasiz) va birinchi bo'yoq uchun oxirgi tanlov nusxasi. Manba — baza (DB ustun):
 * panel har ochilganda cookie bazadagi qiymatga tenglashtiriladi. Qiymat: "<mobileLayout>.<colorMode>".
 */
export const UI_PREFS_COOKIE = "insof_sa_ui";
export const encodeUiCookie = (p: UiPrefs) => `${p.mobileLayout}.${p.colorMode}`;
export function decodeUiCookie(v: string | undefined | null): UiPrefs {
  const [m, c] = (v ?? "").split(".");
  return readUiPrefs({ mobileLayout: m, colorMode: c });
}
