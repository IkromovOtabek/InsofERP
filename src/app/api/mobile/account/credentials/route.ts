import { bearerToken, mobileLogout, mobileReissue, requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { ListError } from "@/lib/mobile/list";
import { confirmSelfChange, LOGIN_HINT, selfAccount } from "@/lib/self-account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ilovadagi «Login va parolni o'zgartirish» (ERP xodimi) — veb «Mening hisobim» bilan bitta qoida (`lib/self-account.ts`):
 * kartada telefon bo'lsa — Telegram'ga kelgan 6 xonali kod (`POST …/credentials/code`), bo'lmasa — joriy parol.
 *   · GET  — { login, phone, needsCode, eco, loginHint };
 *   · POST { login?, password?, password2?, code?, currentPassword?, refreshToken? } — o'zgartiradi; boshqa qurilmalar chiqadi,
 *     shu telefon yangi juftlikni oladi: { ok, login, passwordChanged, accessToken, refreshToken, user }.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireMobileUser(req);
    const a = await selfAccount(user.id);
    if (!a) throw new ListError("NOT_FOUND", "Hisob topilmadi", 404);
    return { login: a.login, phone: a.phone, needsCode: !!a.phone, eco: a.eco, loginHint: LOGIN_HINT };
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const s = (k: string) => (typeof body?.[k] === "string" ? (body[k] as string) : "");
  return handle(async () => {
    const user = await requireMobileUser(req);
    const password = s("password");
    if (password && s("password2") && password !== s("password2")) throw new ListError("BAD_REQUEST", "Yangi parollar bir xil emas", 400);
    const r = await confirmSelfChange(user.id, { login: s("login"), password, code: s("code"), currentPassword: s("currentPassword") }, { web: false });
    if (!r.ok) throw new ListError("ACTION_FAILED", r.error, 400);
    // Eski juftlik sessionVersion bilan baribir kuydi; aniq bo'lishi uchun shu qurilmanikini ham rad ro'yxatiga qo'yamiz
    await mobileLogout(bearerToken(req), s("refreshToken")).catch(() => undefined);
    const tokens = await mobileReissue(user.id);
    return { ok: true, login: r.login, passwordChanged: r.passwordChanged, ...tokens };
  });
}

export const OPTIONS = preflight;
