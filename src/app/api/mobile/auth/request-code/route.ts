import { z } from "zod";
import { requestLoginCode } from "@/lib/sms-login";
import { MobileAuthError } from "@/lib/mobile/auth";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";
import { ipFromHeaders } from "@/lib/login-guard";
import { hit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ phone: z.string().min(1, "Telefon raqamini kiriting") });

/** Kod so'rash: bitta IP'dan soatiga (raqamdan qat'i nazar). */
const PER_IP_HOUR = 10;
const LIMITED = "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring yoki Otdel kadrga murojaat qiling.";

/**
 * POST /api/mobile/auth/request-code — {phone} → kirish kodini yuboradi.
 *
 * Javob mavjud va noma'lum raqam uchun AYNAN bir xil (`{sent:true}`, kanal `via` qaytarilmaydi) —
 * kimning raqami tizimda borligi oshkor bo'lmasin. Cheklovlar (IP va raqam bo'yicha) ham ikkalasiga
 * bir xil qo'llanadi. `devCode` faqat dev/test rejimida qaytadi (prodda hech qachon).
 */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return jsonErr("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot to'liq emas", 400);
  if (!hit(`login-code:ip:${ipFromHeaders(req.headers)}`, PER_IP_HOUR, 3600_000)) return jsonErr("RATE_LIMIT", LIMITED, 429);
  return handle(async () => {
    const r = await requestLoginCode(p.data.phone);
    // Soatlik chek kabi ko'rinadigan xato — 429 bilan qaytadi (handle MobileAuthError'ni biladi).
    if (!r.ok) throw new MobileAuthError("RATE_LIMIT", r.error, 429);
    return { sent: true, ...(r.devCode ? { devCode: r.devCode } : {}) };
  });
}

export const OPTIONS = preflight;
