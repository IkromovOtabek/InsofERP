import { normalizePhone } from "@/lib/phone";
import { isTestMode, externalAllowed } from "@/lib/test-mode";

/**
 * Telegram Gateway API — tasdiqlash (OTP) kodlarini foydalanuvchining Telegram'iga to'g'ridan-to'g'ri
 * yuboradi (botga ulanmasdan). Kirish, parol tiklash va ro'yxatdan o'tish kodlari uchun asosiy kanal
 * (bot ulangan bo'lsa — undan keyingi). SMS kanali yo'q.
 *
 * Hujjat: https://core.telegram.org/gateway/api
 *   POST https://gatewayapi.telegram.org/sendVerificationMessage
 *   Authorization: Bearer <TELEGRAM_GATEWAY_TOKEN>
 *   { phone_number: "+998…", code: "123456", ttl: 300, sender_username?: "…", payload?: "…" }
 *
 * Xavfsizlik / test: `TELEGRAM_GATEWAY_TOKEN` bo'lmasa yoki test rejimida — HECH QANDAY tarmoq so'rovi
 * yuborilmaydi (`externalAllowed` gatewayapi hostiga test rejimida ruxsat bermaydi), natija SKIPPED bo'lib
 * qaytadi va kod konsolga chiqadi (dev). Shu sabab `.env.test` da token bo'sh bo'lishi shart
 * (`lib/test-mode.ts` buni majburlaydi).
 */

const API = "https://gatewayapi.telegram.org";

export function gatewayToken(): string {
  return (process.env.TELEGRAM_GATEWAY_TOKEN ?? "").trim();
}

/** Kod yuborishga tayyormi: token bor, test rejimi emas va tashqi so'rovga ruxsat bor. */
export function gatewayEnabled(): boolean {
  return !!gatewayToken() && !isTestMode() && externalAllowed(API);
}

export type GatewayResult =
  | { ok: true; requestId: string; cost?: number; balance?: number }
  | { ok: false; reason: "DISABLED" | "BAD_PHONE" | "RATE_LIMIT" | "FAILED"; error?: string };

type GatewayEnvelope = {
  ok: boolean;
  error?: string;
  result?: { request_id?: string; request_cost?: number; remaining_balance?: number };
};

/**
 * Bir martalik kodni Telegram Gateway orqali yuboradi (o'zimiz yaratgan `code` bilan — tekshirishni
 * tizimning o'zi qiladi, Gateway faqat yetkazadi). `ttl` — xabar amal qilish muddati (soniya; yetmasa pul qaytadi).
 */
export async function sendGatewayCode(
  rawPhone: string | null | undefined,
  code: string,
  opts?: { ttlSec?: number; payload?: string },
): Promise<GatewayResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: "BAD_PHONE" };

  if (!gatewayEnabled()) {
    // Test/dev yoki token yo'q: tarmoqqa chiqmaymiz. Dev'da oqimni ko'rish uchun kod konsolga.
    if (process.env.NODE_ENV !== "production") console.log(`[tg-gateway · yuborilmadi] ${phone}: kod ${code}`);
    return { ok: false, reason: "DISABLED" };
  }

  const sender = (process.env.TELEGRAM_GATEWAY_SENDER ?? "").trim();
  const body: Record<string, unknown> = {
    phone_number: phone,
    code,
    ttl: Math.min(3600, Math.max(30, opts?.ttlSec ?? 300)),
    ...(sender ? { sender_username: sender } : {}),
    ...(opts?.payload ? { payload: opts.payload.slice(0, 128) } : {}),
  };

  try {
    const res = await fetch(`${API}/sendVerificationMessage`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${gatewayToken()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as GatewayEnvelope;
    if (!res.ok || !data.ok || !data.result?.request_id) {
      const err = data.error || `HTTP ${res.status}`;
      // Gateway cheklovlari: FLOOD / too many requests
      if (/flood|too.?many|rate/i.test(err)) return { ok: false, reason: "RATE_LIMIT", error: err };
      return { ok: false, reason: "FAILED", error: err };
    }
    return { ok: true, requestId: data.result.request_id, cost: data.result.request_cost, balance: data.result.remaining_balance };
  } catch (e) {
    return { ok: false, reason: "FAILED", error: e instanceof Error ? e.message : String(e) };
  }
}
