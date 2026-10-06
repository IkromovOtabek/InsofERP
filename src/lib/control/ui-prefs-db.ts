import { control } from "./db";
import { readUiPrefs, uiPrefsPatch, type UiPrefs } from "./ui-prefs";

/** Admin prefs'i (bazadan; yo'q bo'lsa standart). */
export async function loadUiPrefs(adminId: string): Promise<UiPrefs> {
  const a = await control.superAdmin.findUnique({ where: { id: adminId }, select: { uiPrefs: true } });
  return readUiPrefs(a?.uiPrefs);
}

/**
 * O'z prefs'ini yozish. `adminId` faqat sessiyadan keladi (server action requireAdmin natijasi) — so'rov tanasida
 * admin identifikatori yo'q: zod `strictObject` ortiqcha kalitni (adminId, id …) rad etadi.
 * Qaytadi: yangi to'liq prefs, oldingisi (jurnal uchun) yoki xato matni.
 */
export async function saveOwnUiPrefs(adminId: string, input: unknown): Promise<{ ok: true; prefs: UiPrefs; prev: UiPrefs } | { ok: false; error: string }> {
  const parsed = uiPrefsPatch.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Noto'g'ri qiymat" };
  const prev = await loadUiPrefs(adminId);
  const prefs: UiPrefs = { ...prev, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) } as UiPrefs;
  await control.superAdmin.update({ where: { id: adminId }, data: { uiPrefs: prefs } });
  return { ok: true, prefs, prev };
}
