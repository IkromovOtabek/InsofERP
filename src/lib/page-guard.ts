import { redirect } from "next/navigation";
import { getSession, type Session } from "./auth";
import type { Role } from "@/generated/prisma";
import { OWN_PAGE_ONLY, alwaysOpen, pathAllowed, canWrite } from "./nav";
import { canDo } from "./permissions";
import { AccessDenied, notSignedIn } from "./access-denied";

/**
 * Sahifa darajasidagi himoya — ma'lumot o'qiydigan har bir sahifa boshida chaqiriladi.
 *
 * Middleware faqat token imzosini ko'radi (Edge'da baza yo'q), `(app)/layout` esa klient
 * navigatsiyasida (RSC so'rovi) qayta ishlamasligi mumkin. Shuning uchun bo'shatilgan,
 * paroli almashgan yoki bo'limi o'zgargan xodimning eski tokeni bilan sahifa ma'lumoti
 * o'qilmasin: sessiya bazadan tekshiriladi (isActive, sessionVersion) va yo'l ruxsati
 * bazadagi joriy rol bo'yicha qayta hisoblanadi.
 *
 * `path` — sahifaning statik prefiksi (masalan "/receipts" — /receipts/[id] uchun ham).
 */
export async function requirePage(path: string): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/api/logout");
  const own = OWN_PAGE_ONLY[s.role];
  if (own && !path.startsWith(own) && !alwaysOpen(path)) redirect(own);
  // Modul ruxsati (perms) ham shu yerda hisobga olinadi: direktor "yo'q" qilib qo'ygan modul yopiq,
  // "ko'rish" bergan modul (rol ko'rmasa ham) ochiq.
  if (!pathAllowed(path, s.role, s.perms)) redirect("/dashboard?denied=1");
  return s;
}

/**
 * Server action ichida modulga YOZISH huquqini talab qiladi (zayavka ochish/qabul, to'lov, sklad...).
 * Ruxsat bo'lmasa `AccessDenied` (403) — chaqiruvchi (action) xatoni foydalanuvchiga ko'rsatadi.
 * Modul darajali: "view" bergan foydalanuvchi ko'radi, lekin yoza olmaydi.
 */
export async function requireWrite(module: string): Promise<Session> {
  const s = await getSession();
  if (!s) throw notSignedIn();
  if (!canWrite(s, module)) throw new AccessDenied("Bu bo'limda sizda faqat ko'rish huquqi bor — o'zgartirish uchun direktordan ruxsat so'rang");
  return s;
}

/**
 * Sahifa ichidagi rol tekshiruvi (`requireSession` ning sahifa varianti): ruxsat bo'lmasa xato
 * tashlamaydi, balki qaytaradi. Aks holda yo'l prefiksi middleware'dan o'tgan, lekin sahifa
 * rollariga kirmagan xodim (masalan, mexanik → /trips/new) "Xatolik" (500) sahifasini ko'rardi.
 * DIRECTOR — `requireSession` dagidek har doim o'tadi.
 */
export async function requireRoles(allowed: readonly Role[], grant?: Grant): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/api/logout");
  if (s.role !== "DIRECTOR" && !allowed.includes(s.role) && !(grant && granted(s, grant))) redirect(OWN_PAGE_ONLY[s.role] ?? "/dashboard?denied=1");
  return s;
}

/**
 * Direktor bergan ruxsat sahifani ochadimi: `module` — modulni ko'rish huquqi (perms'da berilgan bo'lsa),
 * `actions` — shu amallardan birortasi (masalan yangi zayavka sahifasi — "create" yoki "stock").
 */
export type Grant = { module: string; actions?: string[] };
function granted(s: Session, g: Grant): boolean {
  if (g.actions?.length) return g.actions.some((a) => canDo(s, g.module, a));
  const lvl = s.perms?.[g.module];
  return !!lvl && lvl !== "none";
}
