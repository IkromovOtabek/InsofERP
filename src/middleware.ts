import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { OWN_PAGE_ONLY, pathAllowed } from "@/lib/nav";
import type { Role } from "@/generated/prisma";
import { authSecret, JWT_ALGS } from "@/lib/secret";

/**
 * Login talab qilmaydigan yo'llar: ommaviy taqdimot, maxfiylik siyosati (do'konlar uchun), login, QR tekshiruv, Telegram va Insof ECO webhook'lari
 * (maxfiy token/imzo bilan himoyalangan), `/api/health` (deploy va kuzatuv uchun, maxfiy ma'lumotsiz) va mobil ilova API'si (o'z Bearer tokeni bilan himoyalangan —
 * `lib/mobile/auth.ts`; cookie sessiyasiga tayanmaydi).
 */
const isPublic = (p: string) =>
  p.startsWith("/taqdimot") || p.startsWith("/maxfiylik") || p.startsWith("/login") || p.startsWith("/verify") || p.startsWith("/api/public") || p.startsWith("/api/telegram") || p.startsWith("/api/eco") || p.startsWith("/api/mobile") || p.startsWith("/api/control") || p === "/api/health" || p === "/api/logout";

/**
 * Markaziy panel (INSOF_MODE=control, admin.insof.uz): korxona sahifalari yo'q — faqat /superadmin.
 * Sessiya — alohida `insof_admin` cookie (`typ: "admin"`); to'liq tekshiruv `requireAdmin` da (control baza).
 */
async function controlMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Holat tekshiruvi (deploy.sh, health-watch.sh) — login'siz, maxfiy ma'lumotsiz
  if (pathname === "/api/health") return NextResponse.next();
  if (!pathname.startsWith("/superadmin")) return NextResponse.redirect(new URL("/superadmin", req.url));
  if (pathname.startsWith("/superadmin/login")) return NextResponse.next();
  const token = req.cookies.get("insof_admin")?.value;
  let ok = false;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
      ok = payload.typ === "admin";
    } catch { ok = false; }
  }
  return ok ? NextResponse.next() : NextResponse.redirect(new URL("/superadmin/login", req.url));
}

export async function middleware(req: NextRequest) {
  if (process.env.INSOF_MODE === "control") return controlMiddleware(req);
  // Korxona jarayonida markaziy panel yo'q
  if (req.nextUrl.pathname.startsWith("/superadmin")) return new NextResponse("Not found", { status: 404 });
  const token = req.cookies.get("insof_session")?.value;
  let role: Role | null = null;
  if (token) {
    // Bu yerda faqat imzo va muddat (Edge'da baza yo'q); hisob faolligi va sessionVersion
    // sahifa/action ichida `getSession` da bazadan tekshiriladi.
    // Mobil ilova tokenlari (`typ`: access/refresh, 30 kungacha) veb cookie sifatida o'tmaydi
    try {
      const { payload } = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
      role = payload.typ === undefined && typeof payload.userId === "string" ? (payload.role as Role) : null;
    } catch { role = null; }
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
  // API marshrutlari ruxsatni o'zi tekshiradi (getSession + rol/canDo) — sahifa qoidasi (NAV) ularga qo'llanmaydi,
  // aks holda direktor bo'lmagan rollar uchun /api/geo, /api/ai, /api/scan bloklanib qoladi.
  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (!pathAllowed(pathname, role)) return NextResponse.redirect(new URL("/dashboard?denied=1", req.url));
  return NextResponse.next();
}

export const config = {
  // `media` va `taqdimot` — ommaviy saytdagi surat va videolar (`public/…`). Ular tekshiruvdan
  // o'tsa, tizimga kirmagan mehmon uchun /login ga yo'naltiriladi va banner ochilmaydi.
  // `robots.txt`/`sitemap.xml` — Google shu yo'llarni mehmon sifatida o'qiydi.
  // `uploads` bu ro'yxatda yo'q: u hujjatlar uchun, himoyada qoladi.
  matcher: ["/((?!_next/static|_next/image|media/|taqdimot/|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)"],
};
