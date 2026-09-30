import { redirect } from "next/navigation";
import { getSession, type Session } from "./auth";
import { OWN_PAGE_ONLY, pathAllowed } from "./nav";

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
  if (!pathAllowed(path, s.role)) redirect("/dashboard?denied=1");
  return s;
}
