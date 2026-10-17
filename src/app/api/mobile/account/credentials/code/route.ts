import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { ListError } from "@/lib/mobile/list";
import { requestSelfChangeCode } from "@/lib/self-account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mobile/account/credentials/code — login/parol o'zgartirish kodi xodim kartasidagi raqamga (Telegram).
 * Veb «Mening hisobim» → «Kod yuborish» bilan bir xil (`requestSelfChangeCode`): soatiga 3 ta, 5 daqiqa amal qiladi.
 * `devCode` faqat sinov muhitida (Telegram ulanmagan dev server) qaytadi — vebdagi kabi.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireMobileUser(req);
    const r = await requestSelfChangeCode(user.id);
    if (!r.ok) throw new ListError("ACTION_FAILED", r.error, 400);
    return { ok: true, ...(r.devCode ? { devCode: r.devCode } : {}) };
  });
}

export const OPTIONS = preflight;
