import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { cancelFromApp, pendingFor, requestFromApp } from "@/lib/account-deletion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ilovadagi "Hisobni o'chirish" (ERP logini bilan kirgan xodim). Xodim hisobini direktor bergan,
 * shuning uchun darhol o'chirilmaydi — so'rov tushadi, direktor Sozlamalarda tasdiqlaydi.
 * ECO mijozlari uchun bu ECO tomonida (`DELETE /v1/me`) va darhol.
 */

/** GET — ochiq so'rov bormi (ilova tugma o'rniga "so'rov yuborilgan" ko'rsatadi). */
export async function GET(req: Request) {
  return handle(async () => pendingFor((await requireMobileUser(req)).id));
}

/** POST {note?} — so'rov qoldirish. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  return handle(async () => requestFromApp(await requireMobileUser(req), note));
}

/** DELETE — so'rovni qaytarib olish. */
export async function DELETE(req: Request) {
  return handle(async () => cancelFromApp((await requireMobileUser(req)).id));
}

export const OPTIONS = preflight;
