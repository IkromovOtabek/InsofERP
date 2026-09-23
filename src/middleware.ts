import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { NAV } from "@/lib/nav";
import type { Role } from "@/generated/prisma";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret");

/**
 * Login talab qilmaydigan yo'llar: login, QR tekshiruv, Telegram va Insof ECO webhook'lari
 * (maxfiy token/imzo bilan himoyalangan) va mobil ilova API'si (o'z Bearer tokeni bilan himoyalangan —
 * `lib/mobile/auth.ts`; cookie sessiyasiga tayanmaydi).
 */
const isPublic = (p: string) =>
  p.startsWith("/login") || p.startsWith("/verify") || p.startsWith("/api/public") || p.startsWith("/api/telegram") || p.startsWith("/api/eco") || p.startsWith("/api/mobile");

/** Sahifa darajasidagi ruxsat: yo'l NAV'dagi qaysi bo'limga tegishli bo'lsa, shu rollar kiradi. */
function allowed(pathname: string, role: Role) {
  if (role === "DIRECTOR") return true;
  const item = NAV.filter((i) => pathname.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  if (!item) return true;
  return item.roles === "all" || item.roles.includes(role);
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("insof_session")?.value;
  let role: Role | null = null;
  if (token) {
    try { role = (await jwtVerify(token, secret())).payload.role as Role; } catch { role = null; }
  }
  const { pathname } = req.nextUrl;

  // "/" — ommaviy sayt (landing). Xodim tizimga kirgan bo'lsa ham shu yerda qoladi:
  // kabinetga o'tish uchun sahifada alohida havola bor.
  if (pathname === "/") return NextResponse.next();
  if (role && pathname.startsWith("/login")) return NextResponse.redirect(new URL("/dashboard", req.url));
  if (isPublic(pathname)) return NextResponse.next();
  if (!role) return NextResponse.redirect(new URL("/login", req.url));
  // Haydovchi vebda faqat o'z reyslarini ko'radi (asosiy ish joyi — ilova)
  if (role === "DRIVER" && !pathname.startsWith("/mening-reyslarim") && !pathname.startsWith("/qollanma") && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/mening-reyslarim", req.url));
  }
  if (!allowed(pathname, role)) return NextResponse.redirect(new URL("/dashboard?denied=1", req.url));
  return NextResponse.next();
}

export const config = {
  // `media` — ommaviy saytdagi surat va videolar (`public/media`). Ular tekshiruvdan
  // o'tsa, tizimga kirmagan mehmon uchun /login ga yo'naltiriladi va banner ochilmaydi.
  // `uploads` bu ro'yxatda yo'q: u hujjatlar uchun, himoyada qoladi.
  matcher: ["/((?!_next/static|_next/image|media/|favicon.ico|icon.svg).*)"],
};
