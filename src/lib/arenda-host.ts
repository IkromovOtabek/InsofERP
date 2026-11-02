import { NextResponse, type NextRequest } from "next/server";
import type { Role } from "@/generated/prisma";
import { OWN_PAGE_ONLY } from "@/lib/nav";
import { redirectUrl } from "@/lib/redirect-url";

/**
 * Arenda alohida domenda (masalan `arenda.insof-erp.uz`): xuddi shu korxona jarayoni va bazasi, lekin u domendan
 * faqat Arenda bo'limi ochiladi — menyu, kirish sahifasi va sarlavha «Insof Arenda». Sessiya cookie'si domenga
 * bog'langan, shuning uchun arenda domeniga alohida kiriladi.
 *
 * `ARENDA_HOST` (tenants/<slug>.env) — domen. Berilgan bo'lsa asosiy domendagi `/arenda` sahifalari shu domenga
 * o'tkaziladi, kvitansiya QR'i va ijarachiga Telegram havolasi ham shu domen bilan yasaladi. Berilmasa — hammasi
 * avvalgidek. Lokalda `arenda.localhost:<port>` arenda domeni hisoblanadi (sinash uchun).
 *
 * Bu himoya emas, ko'rinish: ruxsatlar har doimgidek sahifa va amallarda tekshiriladi. Edge (middleware) va Node'da ishlaydi.
 */
export const ARENDA_PATH = "/arenda";

const HOST_RE = /^[a-z0-9.-]+$/;

/** Sozlangan arenda domeni (portsiz, kichik harf) yoki null */
export function arendaHost(): string | null {
  const h = (process.env.ARENDA_HOST ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return h && HOST_RE.test(h) ? h : null;
}

/**
 * So'rov arenda domenidanmi. Avval `X-Forwarded-Host`: nginx unga `$host` ni yozadi, server action `redirect()` dan
 * keyingi ichki so'rovda esa asl domen faqat shu sarlavhada qoladi (`Host` u yerda ichki manzil). Bo'lmasa — `Host`.
 */
export function isArendaHost(h: { get(name: string): string | null }): boolean {
  const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (!host) return false;
  return host === arendaHost() || (process.env.NODE_ENV !== "production" && host === "arenda.localhost");
}

/** QR va Telegram havolalari uchun arenda domeni manzili (sozlanmagan bo'lsa null) */
export function arendaOrigin(): string | null {
  const h = arendaHost();
  return h ? `https://${h}` : null;
}

export const ARENDA_DENIED = "Bu hisobda Arenda bo'limiga ruxsat yo'q. Direktordan ruxsat so'rang yoki boshqa hisob bilan kiring.";

const isArendaPath = (p: string) => p === ARENDA_PATH || p.startsWith(`${ARENDA_PATH}/`);

/**
 * Arenda domenida ochiladigan yo'llar: Arenda, shaxsiy hisob (parol), kirish va parol tiklash, ommaviy QR kvitansiya,
 * API (o'zi tekshiradi), Next ichki yo'llari va `public/` dagi fayllar. Qolgani — ERP bo'limlari va sayt.
 */
const arendaPathOpen = (p: string) =>
  isArendaPath(p) || p === "/hisobim" || p.startsWith("/hisobim/") || p === "/login" || p.startsWith("/login/reset") ||
  p.startsWith("/k/") || p.startsWith("/api/") || p.startsWith("/_") || /\.[a-z0-9]+$/i.test(p);

/**
 * Middleware'dagi domen qoidasi; null — odatdagi tekshiruvlar davom etadi.
 * Arenda domenida «/» va boshqa bo'limlar → /arenda (kirmagan bo'lsa /login). Arenda'ga ruxsati yo'q hisob
 * (sahifa himoyasi `/dashboard?denied` ga qaytargan yoki faqat o'z sahifasi bor rol) — shu domendagi cookie
 * o'chiriladi va kirish sahifasida sabab chiqadi: aks holda /arenda ↔ /dashboard aylanib qolardi.
 * Asosiy domenda (`ARENDA_HOST` berilgan bo'lsa) /arenda sahifalari arenda domeniga o'tadi.
 */
export function arendaRedirect(req: NextRequest, role: Role | null): NextResponse | null {
  const { pathname, search, searchParams } = req.nextUrl;
  if (!isArendaHost(req.headers)) {
    const host = arendaHost();
    return host && isArendaPath(pathname) ? NextResponse.redirect(new URL(`${pathname}${search}`, `https://${host}`)) : null;
  }
  const own = role ? OWN_PAGE_ONLY[role] : undefined;
  if (role && ((pathname === "/dashboard" && searchParams.has("denied")) || (own && own !== ARENDA_PATH))) {
    // Kirish sahifasining o'zida — faqat cookie o'chadi (cookie'ni o'zgartira olmaydigan ichki so'rov aylanib qolmasin)
    const res = pathname.startsWith("/login") ? NextResponse.next() : NextResponse.redirect(redirectUrl(req, "/login?arenda=yopiq"));
    res.cookies.delete("insof_session");
    return res;
  }
  if (role && pathname.startsWith("/login")) return NextResponse.redirect(redirectUrl(req, ARENDA_PATH));
  if (!arendaPathOpen(pathname)) return NextResponse.redirect(redirectUrl(req, role ? ARENDA_PATH : "/login"));
  return null;
}
