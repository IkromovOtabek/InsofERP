import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { OWN_PAGE_ONLY, pathAllowed } from "@/lib/nav";
import type { Role } from "@/generated/prisma";
import { authSecret, JWT_ALGS } from "@/lib/secret";

/**
 * Login talab qilmaydigan yo'llar: ommaviy taqdimot, login, QR tekshiruv, Telegram va Insof ECO webhook'lari
 * (maxfiy token/imzo bilan himoyalangan) va mobil ilova API'si (o'z Bearer tokeni bilan himoyalangan —
 * `lib/mobile/auth.ts`; cookie sessiyasiga tayanmaydi).
 */
const isPublic = (p: string) =>
  p.startsWith("/taqdimot") || p.startsWith("/login") || p.startsWith("/verify") || p.startsWith("/api/public") || p.startsWith("/api/telegram") || p.startsWith("/api/eco") || p.startsWith("/api/mobile");

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("insof_session")?.value;
  let role: Role | null = null;
  if (token) {
    // Bu yerda faqat imzo va muddat (Edge'da baza yo'q); hisob faolligi va sessionVersion
    // sahifa/action ichida `getSession` da bazadan tekshiriladi.
    try { role = (await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS })).payload.role as Role; } catch { role = null; }
  }
  const { pathname } = req.nextUrl;

  // "/" — ommaviy sayt (landing). Xodim tizimga kirgan bo'lsa ham shu yerda qoladi:
  // kabinetga o'tish uchun sahifada alohida havola bor.
  if (pathname === "/") return NextResponse.next();
  if (role && pathname.startsWith("/login")) return NextResponse.redirect(new URL("/dashboard", req.url));
  if (isPublic(pathname)) return NextResponse.next();
  if (!role) return NextResponse.redirect(new URL("/login", req.url));
  // Haydovchi va brigadir vebda faqat o'z sahifasini ko'radi (asosiy ish joyi — ilova)
  const ownPage = OWN_PAGE_ONLY[role];
  if (ownPage && !pathname.startsWith(ownPage) && !pathname.startsWith("/qollanma") && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL(ownPage, req.url));
  }
  if (!pathAllowed(pathname, role)) return NextResponse.redirect(new URL("/dashboard?denied=1", req.url));
  return NextResponse.next();
}

export const config = {
  // `media` va `taqdimot` — ommaviy saytdagi surat va videolar (`public/…`). Ular tekshiruvdan
  // o'tsa, tizimga kirmagan mehmon uchun /login ga yo'naltiriladi va banner ochilmaydi.
  // `uploads` bu ro'yxatda yo'q: u hujjatlar uchun, himoyada qoladi.
  matcher: ["/((?!_next/static|_next/image|media/|taqdimot/|favicon.ico|icon.svg).*)"],
};
