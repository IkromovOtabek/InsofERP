import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { NAV } from "@/lib/nav";
import type { Role } from "@/generated/prisma";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret");

/** Login talab qilmaydigan yo'llar: login, QR tekshiruv, Telegram va Insof ECO webhook'lari (maxfiy token/imzo bilan himoyalangan). */
const isPublic = (p: string) =>
  p.startsWith("/login") || p.startsWith("/verify") || p.startsWith("/api/public") || p.startsWith("/api/telegram") || p.startsWith("/api/eco");

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

  if (pathname === "/") return NextResponse.redirect(new URL(role ? "/dashboard" : "/login", req.url));
  if (role && pathname.startsWith("/login")) return NextResponse.redirect(new URL("/dashboard", req.url));
  if (isPublic(pathname)) return NextResponse.next();
  if (!role) return NextResponse.redirect(new URL("/login", req.url));
  if (!allowed(pathname, role)) return NextResponse.redirect(new URL("/dashboard?denied=1", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
