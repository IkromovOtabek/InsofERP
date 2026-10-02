import { redirect } from "next/navigation";
import { getSession, type Session } from "./auth";
import type { Role } from "@/generated/prisma";
import { OWN_PAGE_ONLY, pathAllowed, canWrite } from "./nav";

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
  if (own && !path.startsWith(own) && !path.startsWith("/qollanma")) redirect(own);
  // Modul ruxsati (perms) ham shu yerda hisobga olinadi: direktor "yo'q" qilib qo'ygan modul yopiq,
  // "ko'rish" bergan modul (rol ko'rmasa ham) ochiq.
  if (!pathAllowed(path, s.role, s.perms)) redirect("/dashboard?denied=1");
  return s;
}

/**
 * Server action ichida modulga YOZISH huquqini talab qiladi (zayavka ochish/qabul, to'lov, sklad...).
 * Ruxsat bo'lmasa `Error("FORBIDDEN")` — chaqiruvchi (action) xatoni foydalanuvchiga ko'rsatadi.
 * Modul darajali: "view" bergan foydalanuvchi ko'radi, lekin yoza olmaydi.
 */
export async function requireWrite(module: string): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  if (!canWrite(s, module)) throw new Error("Bu bo'limda sizda faqat ko'rish huquqi bor — o'zgartirish uchun direktordan ruxsat so'rang");
  return s;
}

/**
 * Sahifa ichidagi rol tekshiruvi (`requireSession` ning sahifa varianti): ruxsat bo'lmasa xato
 * tashlamaydi, balki qaytaradi. Aks holda yo'l prefiksi middleware'dan o'tgan, lekin sahifa
 * rollariga kirmagan xodim (masalan, mexanik → /trips/new) "Xatolik" (500) sahifasini ko'rardi.
 * DIRECTOR — `requireSession` dagidek har doim o'tadi.
 */
export async function requireRoles(allowed: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/api/logout");
  if (s.role !== "DIRECTOR" && !allowed.includes(s.role)) redirect(OWN_PAGE_ONLY[s.role] ?? "/dashboard?denied=1");
  return s;
}
