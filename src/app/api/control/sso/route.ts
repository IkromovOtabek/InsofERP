import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { issueSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { verifySso, tenantSsoKeySet } from "@/lib/control/token";
import { isControlMode, tenantSlug } from "@/lib/tenant";

/**
 * IT superadmin markaziy paneldan korxonaga kiradi (SSO). Panel 60 soniyalik, bir martalik, shu korxona
 * (`aud` = TENANT_SLUG) uchun imzolangan tokenni POST forma bilan yuboradi — token URL/loglarga tushmaydi.
 * Imzo kaliti — shu korxonaning o'z `CONTROL_SSO_KEY` i (HMAC(CONTROL_SECRET, slug), lib/control/token.ts).
 *
 * Korxona bazasida `it.<login>` hisobi (rol SUPERADMIN) bo'lmasa ochiladi: paroli tasodifiy, login/parol
 * bilan kirib bo'lmaydi. Ichkarida direktor huquqi; har kirish korxonaning audit jurnaliga yoziladi —
 * direktor IT qachon kirganini ko'radi.
 */
const used = new Map<string, number>(); // jti → muddati (bir jarayon ichida qayta ishlatishga qarshi)

export async function POST(req: Request) {
  if (isControlMode() || !tenantSsoKeySet(tenantSlug())) return new NextResponse("Not found", { status: 404 });
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  let c;
  try {
    c = await verifySso(token, tenantSlug());
  } catch {
    return new NextResponse("Kirish havolasi yaroqsiz yoki muddati o'tgan — paneldan qayta bosing", { status: 401 });
  }
  const now = Date.now();
  for (const [k, exp] of used) if (exp < now) used.delete(k);
  if (used.has(c.jti)) return new NextResponse("Bu havola allaqachon ishlatilgan", { status: 401 });
  used.set(c.jti, now + 120_000);

  const login = `it.${c.adminLogin.toLowerCase().replace(/[^a-z0-9._-]/g, "") || "admin"}`;
  const fullName = `IT: ${c.adminName || c.adminLogin}`;
  const existing = await db.user.findUnique({ where: { login } });
  if (existing && existing.role !== "SUPERADMIN") {
    return new NextResponse(`"${login}" logini korxonada oddiy xodimga tegishli — IT hisobi ochilmadi`, { status: 409 });
  }
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { isActive: true, fullName } })
    : await db.user.create({ data: { login, fullName, role: "SUPERADMIN", passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10) } });

  await issueSession(user);
  await audit(db, user.id, "UPDATE", "User", user.id, undefined, { itKirish: true, admin: c.adminLogin });
  // cookies().set alohida yaratilgan redirect javobiga tushmaydi (api/logout dagi kabi) — javobning o'ziga ko'chiramiz
  const res = NextResponse.redirect(new URL("/dashboard", req.url), 303);
  const session = (await cookies()).get("insof_session")?.value;
  if (session) res.cookies.set("insof_session", session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
  return res;
}
